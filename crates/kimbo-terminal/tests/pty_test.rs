use kimbo_terminal::PtySession;
use std::time::Duration;

#[test]
fn test_pty_spawn_and_write() {
    let mut session = PtySession::new(None, None).expect("failed to spawn PTY");
    session.write(b"echo KIMBO_TEST_MARKER\n");

    let mut output = Vec::new();
    let mut buf = [0u8; 4096];
    let deadline = std::time::Instant::now() + Duration::from_secs(3);

    while std::time::Instant::now() < deadline {
        match session.try_read(&mut buf) {
            Ok(0) => break,
            Ok(n) => output.extend_from_slice(&buf[..n]),
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }

    let text = String::from_utf8_lossy(&output);
    assert!(
        text.contains("KIMBO_TEST_MARKER"),
        "expected marker in output, got: {}",
        text
    );
}

#[test]
fn test_pty_resize() {
    let mut session = PtySession::new(None, None).expect("failed to spawn PTY");
    session.resize(120, 40); // Should not panic
}

#[test]
fn test_pty_cwd() {
    let home = dirs::home_dir();
    let session = PtySession::new(None, home.clone()).expect("failed to spawn PTY");
    std::thread::sleep(Duration::from_millis(500));
    let cwd = session.cwd();
    if cfg!(any(target_os = "macos", target_os = "linux")) {
        assert!(cwd.is_some(), "expected CWD on this platform");
    }
}
