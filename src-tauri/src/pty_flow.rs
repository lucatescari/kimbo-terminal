//! Back pressure between a PTY reader thread and the webview.
//!
//! The reader forwards every chunk it reads as a Tauri event. xterm.js parses
//! at a fraction of the PTY's drain rate, so without a limit a long `cat`
//! queues tens of megabytes of base64 inside the webview (780 MB peak for a
//! 100 MB stream, measured on 1.2.5). `FlowGate` counts bytes in flight: the
//! reader adds after each emit and waits while the count is at or above the
//! high-water mark; the frontend acks bytes once xterm has parsed them.

use std::sync::{Condvar, Mutex};

/// Default limit on bytes emitted to the webview but not yet acknowledged.
/// About 16 reader chunks: enough to keep xterm's parser busy, small enough
/// that Ctrl-C lands within a fraction of a second of output.
pub const DEFAULT_HIGH_WATER: usize = 1024 * 1024;

/// A reader that hit the high-water mark resumes only once this much is
/// left in flight, so it then reads a long run of full chunks instead of one
/// small read per ack (hysteresis).
pub const DEFAULT_LOW_WATER: usize = DEFAULT_HIGH_WATER / 4;

pub struct FlowGate {
    high_water: usize,
    low_water: usize,
    state: Mutex<State>,
    cv: Condvar,
}

struct State {
    in_flight: usize,
    /// Set when a wait hit the high mark; cleared by an ack at the low mark.
    paused: bool,
    closed: bool,
}

impl FlowGate {
    #[cfg(test)]
    pub fn new(high_water: usize) -> Self {
        Self::with_marks(high_water, high_water / 4)
    }

    pub fn with_marks(high_water: usize, low_water: usize) -> Self {
        Self {
            high_water,
            low_water,
            state: Mutex::new(State { in_flight: 0, paused: false, closed: false }),
            cv: Condvar::new(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Record `n` bytes handed to the webview.
    pub fn add(&self, n: usize) {
        let mut st = self.lock();
        st.in_flight = st.in_flight.saturating_add(n);
    }

    /// The webview finished parsing `n` bytes.
    pub fn ack(&self, n: usize) {
        let mut st = self.lock();
        st.in_flight = st.in_flight.saturating_sub(n);
        if st.paused && st.in_flight <= self.low_water {
            st.paused = false;
            self.cv.notify_all();
        }
    }

    /// Wake any waiting reader and make every later wait return `false`.
    pub fn close(&self) {
        self.lock().closed = true;
        self.cv.notify_all();
    }

    #[cfg(test)]
    pub fn in_flight(&self) -> usize {
        self.lock().in_flight
    }

    /// Block once the in-flight count reaches the high-water mark, until an
    /// ack brings it down to the low-water mark. Returns `true` when the
    /// reader may read again, `false` once closed.
    pub fn wait_for_credit(&self) -> bool {
        let mut st = self.lock();
        if st.in_flight >= self.high_water {
            st.paused = true;
        }
        while !st.closed && st.paused {
            st = self.cv.wait(st).unwrap_or_else(|e| e.into_inner());
        }
        !st.closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    fn blocks_for(gate: &Arc<FlowGate>, at_least: Duration) -> bool {
        let g = gate.clone();
        let started = Instant::now();
        let h = thread::spawn(move || g.wait_for_credit());
        thread::sleep(at_least);
        let still_blocked = !h.is_finished();
        // Unblock so the thread can be joined whatever the outcome.
        gate.close();
        h.join().unwrap();
        still_blocked && started.elapsed() >= at_least
    }

    #[test]
    fn under_the_high_water_mark_the_reader_is_not_held() {
        let gate = FlowGate::new(1024);
        gate.add(1023);
        let started = Instant::now();
        gate.wait_for_credit();
        assert!(started.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn at_the_high_water_mark_the_reader_blocks() {
        let gate = Arc::new(FlowGate::new(1024));
        gate.add(1024);
        assert!(blocks_for(&gate, Duration::from_millis(100)));
    }

    #[test]
    fn an_ack_releases_the_reader() {
        let gate = Arc::new(FlowGate::new(1024));
        gate.add(2048);
        let g = gate.clone();
        let h = thread::spawn(move || g.wait_for_credit());
        thread::sleep(Duration::from_millis(50));
        assert!(!h.is_finished());
        gate.ack(2048 - 256); // 256 left in flight: at the low mark
        h.join().unwrap();
        assert_eq!(gate.in_flight(), 256);
    }

    // Without hysteresis the reader runs in lockstep with the parser: each
    // ack lets exactly one read through, the PTY queue is nearly empty by
    // then, so every read is tiny and needs its own IPC round trip. Measured
    // on the first cut: a 10 MB stream took 261 s instead of 3 s.
    #[test]
    fn once_blocked_the_reader_stays_blocked_until_the_low_water_mark() {
        let gate = Arc::new(FlowGate::with_marks(1024, 256));
        gate.add(1024);
        let g = gate.clone();
        let h = thread::spawn(move || g.wait_for_credit());
        thread::sleep(Duration::from_millis(50));
        gate.ack(512); // 512 in flight: below high, above low
        thread::sleep(Duration::from_millis(50));
        assert!(!h.is_finished());
        gate.ack(256); // 256 in flight: at the low mark
        h.join().unwrap();
    }

    #[test]
    fn a_reader_that_never_blocked_is_not_held_between_the_marks() {
        let gate = FlowGate::with_marks(1024, 256);
        gate.add(512);
        let started = Instant::now();
        assert!(gate.wait_for_credit());
        assert!(started.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn acking_more_than_in_flight_saturates_at_zero() {
        let gate = FlowGate::new(1024);
        gate.add(10);
        gate.ack(1_000_000);
        assert_eq!(gate.in_flight(), 0);
    }

    #[test]
    fn close_releases_a_blocked_reader_and_reports_closed() {
        let gate = Arc::new(FlowGate::new(1024));
        gate.add(4096);
        let g = gate.clone();
        let h = thread::spawn(move || g.wait_for_credit());
        thread::sleep(Duration::from_millis(50));
        gate.close();
        // Returns false: the reader should stop, not read again.
        assert!(!h.join().unwrap());
        assert!(!gate.wait_for_credit());
    }

    #[test]
    fn wait_returns_true_while_open() {
        let gate = FlowGate::new(1024);
        assert!(gate.wait_for_credit());
    }
}
