//! Coalesced PTY reads.
//!
//! macOS hands a pty master about 1 KB per `read()` once the consumer is
//! slower than the writer (the tty output queue is that small), so a 100 MB
//! `cat` became 100k events to the webview plus 100k acks back. A reader that
//! has just seen a bulk-sized chunk waits a moment for the next one and
//! returns them together, up to the buffer size. Small interactive output
//! (a keystroke echo, a prompt) is returned at once.

use std::io;
use std::os::unix::io::RawFd;
use std::time::Duration;

/// A first read at least this large means bulk output; smaller reads are
/// interactive and go out immediately.
const BULK_THRESHOLD: usize = 1024;

/// Blocking read of `fd` into `buf` that, after a bulk-sized first chunk,
/// keeps appending whatever arrives within `settle` of the previous chunk,
/// until `buf` is full or the stream goes quiet. Returns the byte count, 0 at
/// end of stream.
pub fn read_coalesced(fd: RawFd, buf: &mut [u8], settle: Duration) -> io::Result<usize> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    let restore = || unsafe {
        libc::fcntl(fd, libc::F_SETFL, flags);
    };

    // First chunk: block until something is there.
    unsafe { libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK) };
    let first = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
    if first < 0 {
        let err = io::Error::last_os_error();
        restore();
        return Err(err);
    }
    let mut total = first as usize;
    if total == 0 || total < BULK_THRESHOLD || total == buf.len() {
        restore();
        return Ok(total);
    }

    // Bulk mode: gather follow-up chunks while they keep coming.
    unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
    let timeout_ms = settle.as_millis().max(1) as libc::c_int;
    while total < buf.len() {
        let mut pfd = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
        let ready = unsafe { libc::poll(&mut pfd, 1, timeout_ms) };
        if ready <= 0 || pfd.revents & libc::POLLIN == 0 {
            break;
        }
        let n = unsafe {
            libc::read(
                fd,
                buf[total..].as_mut_ptr() as *mut libc::c_void,
                buf.len() - total,
            )
        };
        if n <= 0 {
            // EAGAIN, end of stream or an error: hand back what we have; the
            // next call sees the condition on its blocking read.
            break;
        }
        total += n as usize;
    }
    restore();
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::io::FromRawFd;
    use std::thread;
    use std::time::{Duration, Instant};

    fn pipe() -> (std::os::unix::io::RawFd, std::fs::File) {
        let mut fds = [0i32; 2];
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        (fds[0], unsafe { std::fs::File::from_raw_fd(fds[1]) })
    }

    #[test]
    fn small_output_is_returned_without_waiting() {
        let (rfd, mut w) = pipe();
        w.write_all(b"hello").unwrap();
        let mut buf = [0u8; 65536];
        let started = Instant::now();
        let n = read_coalesced(rfd, &mut buf, Duration::from_millis(20)).unwrap();
        assert_eq!(&buf[..n], b"hello");
        assert!(started.elapsed() < Duration::from_millis(10));
    }

    #[test]
    fn bulk_chunks_arriving_in_quick_succession_are_returned_together() {
        let (rfd, mut w) = pipe();
        let writer = thread::spawn(move || {
            for i in 0..8u8 {
                w.write_all(&[i; 4096]).unwrap();
                thread::sleep(Duration::from_micros(200));
            }
        });
        let mut buf = [0u8; 65536];
        let n = read_coalesced(rfd, &mut buf, Duration::from_millis(5)).unwrap();
        writer.join().unwrap();
        assert!(n > 4096, "expected several 4 KB writes in one read, got {n}");
        assert_eq!(n % 4096, 0);
    }

    #[test]
    fn a_lone_bulk_chunk_returns_once_the_settle_window_passes() {
        let (rfd, mut w) = pipe();
        w.write_all(&[7u8; 8192]).unwrap();
        let mut buf = [0u8; 65536];
        let started = Instant::now();
        let n = read_coalesced(rfd, &mut buf, Duration::from_millis(5)).unwrap();
        assert_eq!(n, 8192);
        assert!(started.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn blocks_until_data_arrives() {
        let (rfd, mut w) = pipe();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            w.write_all(b"late").unwrap();
        });
        let mut buf = [0u8; 65536];
        let n = read_coalesced(rfd, &mut buf, Duration::from_millis(5)).unwrap();
        assert_eq!(&buf[..n], b"late");
    }

    #[test]
    fn end_of_stream_is_zero() {
        let (rfd, w) = pipe();
        drop(w);
        let mut buf = [0u8; 65536];
        assert_eq!(read_coalesced(rfd, &mut buf, Duration::from_millis(5)).unwrap(), 0);
    }

    #[test]
    fn leaves_the_fd_blocking_mode_as_it_found_it() {
        let (rfd, mut w) = pipe();
        let before = unsafe { libc::fcntl(rfd, libc::F_GETFL) };
        w.write_all(&[1u8; 8192]).unwrap();
        let mut buf = [0u8; 65536];
        read_coalesced(rfd, &mut buf, Duration::from_millis(5)).unwrap();
        assert_eq!(unsafe { libc::fcntl(rfd, libc::F_GETFL) }, before);
    }
}
