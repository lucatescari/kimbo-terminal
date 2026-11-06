use crate::pty_flow::{FlowGate, DEFAULT_HIGH_WATER, DEFAULT_LOW_WATER};
use kimbo_terminal::{read_coalesced, PtySession};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// Bytes per webview event: fewer, larger events cost less CPU on both
/// sides. Each event is one evaluateJavaScript message to WebKit; after a
/// long stream about 50 MB of their out-of-line buffers stay charged to this
/// process for a while, independent of the chunk size (same at 16 KB).
const READ_CHUNK: usize = 64 * 1024;

/// How long the reader waits for the next bulk chunk before emitting what it
/// has. Bounds the extra latency of coalescing at about one frame.
const READ_SETTLE: std::time::Duration = std::time::Duration::from_millis(2);

pub struct PtyManager {
    sessions: Mutex<HashMap<u32, PtySession>>,
    /// One flow gate per session, shared with its reader thread. See
    /// `pty_flow` for why the reader must wait on the webview.
    gates: Mutex<HashMap<u32, Arc<FlowGate>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            gates: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(
        &self,
        cwd: Option<String>,
        shell: Option<String>,
        command: Option<Vec<String>>,
        app: AppHandle,
    ) -> Result<u32, String> {
        let session = PtySession::new(shell, cwd.map(std::path::PathBuf::from), command)
            .map_err(|e| format!("failed to create PTY: {}", e))?;

        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        let raw_fd = session.master_raw_fd();
        let event_name = format!("pty-output-{}", id);
        let exit_event = format!("pty-exit-{}", id);
        let gate = Arc::new(FlowGate::with_marks(DEFAULT_HIGH_WATER, DEFAULT_LOW_WATER));
        let reader_gate = gate.clone();

        // Spawn background reader thread. READ_CHUNK is the unit of one
        // webview event; read_coalesced fills it from the ~1 KB reads macOS
        // hands out under back pressure.
        std::thread::spawn(move || {
            let mut buf = [0u8; READ_CHUNK];
            loop {
                // Back pressure: stop reading while the webview still has
                // DEFAULT_HIGH_WATER unparsed bytes. The PTY buffer then
                // fills and the child blocks on write, as it would on a
                // native terminal. `false` means the session was closed.
                if !reader_gate.wait_for_credit() {
                    break;
                }
                // Blocking read that gathers bulk output into one chunk:
                // macOS returns ~1 KB per read under back pressure, which
                // would mean one event and one ack per kilobyte.
                let n = read_coalesced(raw_fd, &mut buf, READ_SETTLE).unwrap_or_default();
                if n == 0 {
                    let _ = app.emit(&exit_event, ());
                    break;
                }
                use base64::Engine;
                let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                reader_gate.add(n);
                let _ = app.emit(&event_name, encoded);
            }
        });

        self.gates
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, gate);
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, session);
        Ok(id)
    }

    /// The webview parsed `bytes` of output for `id`. Unknown ids are
    /// ignored: acks can trail a close.
    pub fn ack(&self, id: u32, bytes: usize) {
        let gates = self.gates.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(gate) = gates.get(&id) {
            gate.ack(bytes);
        }
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let pty = sessions.get_mut(&id).ok_or("PTY not found")?;
        pty.write(data);
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let pty = sessions.get_mut(&id).ok_or("PTY not found")?;
        pty.resize(cols, rows);
        Ok(())
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        // Release the reader first: a thread parked in wait_for_credit never
        // reaches the read() that would see the closed fd.
        if let Some(gate) = self
            .gates
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id)
        {
            gate.close();
        }
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        // Kill BEFORE removing so the kill is observable from this command
        // result and not coupled to Drop firing. Drop still runs on remove,
        // but kill_tree's idempotency guard makes it a no-op the second time.
        if let Some(session) = sessions.get(&id) {
            session.kill_tree();
        }
        sessions.remove(&id);
        Ok(())
    }

    pub fn get_cwd(&self, id: u32) -> Result<Option<String>, String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let pty = sessions.get(&id).ok_or("PTY not found")?;
        Ok(pty.cwd().map(|p| p.to_string_lossy().to_string()))
    }

    pub fn is_busy(&self, id: u32) -> Result<bool, String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let pty = sessions.get(&id).ok_or("PTY not found")?;
        Ok(pty.is_busy())
    }

    /// Read the shell pid for a session, used by the claude-resume probe.
    pub fn pid_of(&self, id: u32) -> Result<u32, String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let pty = sessions.get(&id).ok_or("PTY not found")?;
        Ok(pty.pid())
    }

    /// Synchronously kill every live PTY session's process tree. Called by
    /// `quit_app` immediately before `app.exit(0)` — Tauri's `app.exit` does
    /// not run `Drop` on managed `State`, so without this every shell would
    /// orphan to launchd on quit. SIGHUP is synchronous; the SIGKILL
    /// escalation runs on detached 150 ms timers per session, which is fine
    /// because the kimbo process itself takes longer than that to actually
    /// exit and the well-behaved processes have already gone.
    pub fn kill_all(&self) {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for session in sessions.values() {
            session.kill_tree();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn poisoned_lock_is_recovered_not_panicked() {
        let mgr = Arc::new(PtyManager::new());
        let m2 = mgr.clone();
        // Poison the mutex by panicking while holding the lock.
        let _ = std::thread::spawn(move || {
            let _g = m2.sessions.lock().unwrap();
            panic!("poison");
        })
        .join();
        // These must not panic even though the mutex is now poisoned.
        // Session 999 does not exist so both calls return Err("PTY not found"),
        // which proves the mutex lock was recovered rather than panicking.
        assert!(mgr.is_busy(999).is_err());
        assert!(mgr.get_cwd(999).is_err());
    }
}
