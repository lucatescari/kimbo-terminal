//! Listens on a Unix domain socket for events from `kimbo-claude-notify`.
//! Each connection writes one JSON line; we parse it into `NotifyEvent` and
//! emit a `claude-notify` Tauri event to the frontend.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotifyEvent {
    pub session_id: String,
    pub kind: String, // "stop" | "notification"
    pub ts: u64,
    pub message: Option<String>,
}

/// Parse one JSON line from the sidecar. Returns `None` for anything we
/// don't recognize; the caller drops the line silently.
pub fn parse_event_line(line: &str) -> Option<NotifyEvent> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    let session_id = v.get("session_id")?.as_str()?.to_string();
    let kind = v.get("kind")?.as_str()?.to_string();
    if kind != "stop" && kind != "notification" {
        return None;
    }
    let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);
    let message = v.get("message").and_then(|m| m.as_str()).map(String::from);
    Some(NotifyEvent { session_id, kind, ts, message })
}

use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Resolve the same socket path the sidecar uses.
///
/// Layout: `$HOME/.kimbo/notify.sock`. The spec called for a `<uid>` suffix
/// (`notify-<uid>.sock`) for multi-user isolation, but `$HOME` already
/// provides per-user isolation on macOS — adding `<uid>` would only matter
/// in the unusual case of a shared home dir across machines, which kimbo
/// doesn't otherwise support. Kept simple here; promote to `<uid>` if a
/// shared-home scenario surfaces.
pub fn socket_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".kimbo").join("notify.sock"))
}

/// Try to clear a stale socket file at `path`. If a connect succeeds another
/// kimbo is listening — return `Err(())`. If connect fails with anything else
/// (typically `ECONNREFUSED` or `ENOENT`) we treat the file as stale and
/// remove it.
pub fn clear_stale_socket(path: &Path) -> Result<(), ()> {
    if !path.exists() {
        return Ok(());
    }
    match std::os::unix::net::UnixStream::connect(path) {
        Ok(_) => Err(()), // someone is listening
        Err(_) => {
            let _ = std::fs::remove_file(path);
            Ok(())
        }
    }
}

/// Start the listener as a background tokio task. Returns immediately.
/// On every received event, calls `on_event` with the parsed payload.
///
/// If bind fails (path race, permission, EADDRINUSE on some platforms), logs
/// and returns — the app stays alive without notify-events in this window.
pub fn spawn_listener<F>(path: PathBuf, on_event: F)
where
    F: Fn(NotifyEvent) + Send + Sync + 'static,
{
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::net::UnixListener;

    let on_event = Arc::new(on_event);

    tauri::async_runtime::spawn(async move {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(()) = clear_stale_socket(&path) {
            log::info!("notify-socket: another kimbo is listening; this window will not receive events");
            return;
        }
        let listener = match UnixListener::bind(&path) {
            Ok(l) => l,
            Err(e) => {
                log::warn!("notify-socket bind failed at {path:?}: {e}");
                return;
            }
        };
        log::info!("notify-socket listening at {path:?}");
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("notify-socket accept error: {e}");
                    continue;
                }
            };
            let on_event = on_event.clone();
            tauri::async_runtime::spawn(async move {
                // Contract: one connection = one event = one line, then EOF.
                // The sidecar enforces this. If a future change has it write
                // multiple events on one stream, switch to a `lines()` loop;
                // today, anything after the first newline is silently dropped
                // when the sidecar closes the stream.
                let mut reader = BufReader::new(stream);
                let mut line = String::new();
                if reader.read_line(&mut line).await.is_err() {
                    return;
                }
                if let Some(ev) = parse_event_line(&line) {
                    on_event(ev);
                } else {
                    log::warn!("notify-socket: dropped event (line did not parse): {line:?}");
                }
            });
        }
    });
}

#[cfg(test)]
mod listener_tests {
    use super::*;

    #[test]
    fn clear_stale_socket_succeeds_when_path_missing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("notify.sock");
        assert_eq!(clear_stale_socket(&p), Ok(()));
    }

    #[test]
    fn clear_stale_socket_unlinks_dead_path() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("notify.sock");
        std::fs::write(&p, b"junk").unwrap();
        assert_eq!(clear_stale_socket(&p), Ok(()));
        assert!(!p.exists());
    }

    #[test]
    fn clear_stale_socket_returns_err_when_listener_alive() {
        use std::os::unix::net::UnixListener;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("notify.sock");
        let _listener = UnixListener::bind(&p).unwrap();
        assert_eq!(clear_stale_socket(&p), Err(()));
        assert!(p.exists());
    }
}

#[cfg(test)]
mod parse_tests {
    use super::*;

    #[test]
    fn parses_stop_event() {
        let line = r#"{"session_id":"abc","kind":"stop","ts":42,"message":null}"#;
        let got = parse_event_line(line).unwrap();
        assert_eq!(got.session_id, "abc");
        assert_eq!(got.kind, "stop");
        assert_eq!(got.ts, 42);
        assert!(got.message.is_none());
    }

    #[test]
    fn parses_notification_event_with_message() {
        let line = r#"{"session_id":"x","kind":"notification","ts":1,"message":"hi"}"#;
        let got = parse_event_line(line).unwrap();
        assert_eq!(got.kind, "notification");
        assert_eq!(got.message.as_deref(), Some("hi"));
    }

    #[test]
    fn rejects_unknown_kind() {
        let line = r#"{"session_id":"x","kind":"weird","ts":0,"message":null}"#;
        assert!(parse_event_line(line).is_none());
    }

    #[test]
    fn rejects_missing_fields_or_garbage() {
        assert!(parse_event_line(r#"{"kind":"stop"}"#).is_none());
        assert!(parse_event_line(r#"{"session_id":"x"}"#).is_none());
        assert!(parse_event_line("not json").is_none());
        assert!(parse_event_line("").is_none());
    }
}
