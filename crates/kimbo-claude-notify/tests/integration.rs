use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

const STOP_JSON: &str = r#"{
    "session_id": "abc-123",
    "transcript_path": "/x/y.jsonl",
    "cwd": "/u/proj",
    "hook_event_name": "Stop",
    "stop_hook_active": false
}"#;

const NOTIF_JSON: &str = r#"{
    "session_id": "xyz-789",
    "hook_event_name": "Notification",
    "message": "Claude needs your permission to use Bash"
}"#;

fn run_with_temp_home<F: FnOnce(&std::path::Path)>(stdin: &str, f: F) {
    let dir = tempfile::tempdir().unwrap();
    let kimbo_dir = dir.path().join(".kimbo");
    std::fs::create_dir_all(&kimbo_dir).unwrap();
    let sock_path = kimbo_dir.join("notify.sock");

    // Bind a listener so the sidecar's connect succeeds.
    let listener = UnixListener::bind(&sock_path).unwrap();
    let sock_path_clone = sock_path.clone();
    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let _ = sock_path_clone; // prevent early drop
        line
    });

    let bin = env!("CARGO_BIN_EXE_kimbo-claude-notify");
    let mut child = Command::new(bin)
        .env("HOME", dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    drop(child.stdin.take());
    let status = child.wait().unwrap();
    assert!(status.success(), "sidecar should always exit 0");

    let line = handle.join().unwrap();
    f(&sock_path);
    let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
    let kind = parsed["kind"].as_str().unwrap().to_string();
    let session_id = parsed["session_id"].as_str().unwrap().to_string();
    if stdin == STOP_JSON {
        assert_eq!(kind, "stop");
        assert_eq!(session_id, "abc-123");
    } else {
        assert_eq!(kind, "notification");
        assert_eq!(session_id, "xyz-789");
        assert_eq!(
            parsed["message"],
            "Claude needs your permission to use Bash"
        );
    }
}

#[test]
fn stop_event_writes_one_line_to_socket() {
    run_with_temp_home(STOP_JSON, |_| {});
}

#[test]
fn notification_event_writes_one_line_to_socket() {
    run_with_temp_home(NOTIF_JSON, |_| {});
}

#[test]
fn no_socket_means_silent_success() {
    let dir = tempfile::tempdir().unwrap();
    // Don't bind a listener.
    let bin = env!("CARGO_BIN_EXE_kimbo-claude-notify");
    let mut child = Command::new(bin)
        .env("HOME", dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(STOP_JSON.as_bytes())
        .unwrap();
    drop(child.stdin.take());
    // Bound the wait so a hung sidecar fails the test instead of blocking CI.
    let result = child.wait_timeout(Duration::from_secs(2)).unwrap();
    assert!(
        result.is_some(),
        "sidecar should exit fast even with no listener"
    );
    assert!(result.unwrap().success());
}

#[test]
fn malformed_stdin_is_silent_success() {
    let dir = tempfile::tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_kimbo-claude-notify");
    let mut child = Command::new(bin)
        .env("HOME", dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"not json")
        .unwrap();
    drop(child.stdin.take());
    let status = child.wait().unwrap();
    assert!(
        status.success(),
        "malformed stdin must not break claude's flow"
    );
}

trait WaitTimeout {
    fn wait_timeout(&mut self, dur: Duration) -> std::io::Result<Option<std::process::ExitStatus>>;
}
impl WaitTimeout for std::process::Child {
    fn wait_timeout(&mut self, dur: Duration) -> std::io::Result<Option<std::process::ExitStatus>> {
        let deadline = std::time::Instant::now() + dur;
        loop {
            match self.try_wait()? {
                Some(s) => return Ok(Some(s)),
                None => {
                    if std::time::Instant::now() >= deadline {
                        return Ok(None);
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        }
    }
}
