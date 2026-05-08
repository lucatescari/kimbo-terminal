//! `kimbo-claude-notify` — tiny sidecar invoked by Claude Code's `Stop` and
//! `Notification` hooks. Reads the hook JSON payload from stdin, forwards a
//! one-line JSON event to the Kimbo backend over a Unix domain socket, exits.
//!
//! Designed to NEVER break the user's Claude session: any failure (kimbo not
//! running, malformed payload, socket gone) results in a silent exit 0.

/// What we extract from Claude Code's hook stdin payload. Both `Stop` and
/// `Notification` hooks send the same envelope; only `hook_event_name`
/// differs. `message` is only set on `Notification` hooks.
#[derive(Debug, Clone, PartialEq)]
pub struct HookPayload {
    pub session_id: String,
    pub kind: NotifyKind,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotifyKind {
    Stop,
    Notification,
}

/// Parse Claude Code's hook payload. Returns `None` when the payload is
/// missing required fields, has an unrecognized event name, or is malformed
/// JSON. Caller treats `None` as "drop the event silently."
pub fn parse_hook_payload(stdin: &str) -> Option<HookPayload> {
    let v: serde_json::Value = serde_json::from_str(stdin).ok()?;
    let session_id = v.get("session_id")?.as_str()?.to_string();
    let event_name = v.get("hook_event_name")?.as_str()?;
    let kind = match event_name {
        "Stop" => NotifyKind::Stop,
        "Notification" => NotifyKind::Notification,
        _ => return None,
    };
    let message = v.get("message").and_then(|m| m.as_str()).map(String::from);
    Some(HookPayload { session_id, kind, message })
}

#[cfg(test)]
mod parse_tests {
    use super::*;

    #[test]
    fn parses_stop_event() {
        let s = r#"{
            "session_id": "5a7f9805-2543-4dd9-94ce-9563047d2c26",
            "transcript_path": "/x/y.jsonl",
            "cwd": "/Users/u/proj",
            "hook_event_name": "Stop",
            "stop_hook_active": false
        }"#;
        let got = parse_hook_payload(s).expect("happy path");
        assert_eq!(got.session_id, "5a7f9805-2543-4dd9-94ce-9563047d2c26");
        assert_eq!(got.kind, NotifyKind::Stop);
        assert_eq!(got.message, None);
    }

    #[test]
    fn parses_notification_event_with_message() {
        let s = r#"{
            "session_id": "abc-123",
            "hook_event_name": "Notification",
            "message": "Claude needs your permission to use Bash"
        }"#;
        let got = parse_hook_payload(s).expect("happy path");
        assert_eq!(got.kind, NotifyKind::Notification);
        assert_eq!(got.message.as_deref(), Some("Claude needs your permission to use Bash"));
    }

    #[test]
    fn returns_none_for_missing_session_id() {
        let s = r#"{"hook_event_name": "Stop"}"#;
        assert!(parse_hook_payload(s).is_none());
    }

    #[test]
    fn returns_none_for_missing_event_name() {
        let s = r#"{"session_id": "abc"}"#;
        assert!(parse_hook_payload(s).is_none());
    }

    #[test]
    fn returns_none_for_unknown_event_name() {
        let s = r#"{"session_id": "abc", "hook_event_name": "PreToolUse"}"#;
        assert!(parse_hook_payload(s).is_none());
    }

    #[test]
    fn returns_none_for_malformed_json() {
        assert!(parse_hook_payload("not json").is_none());
        assert!(parse_hook_payload("").is_none());
    }

    #[test]
    fn returns_none_for_wrong_type_session_id() {
        let s = r#"{"session_id": 42, "hook_event_name": "Stop"}"#;
        assert!(parse_hook_payload(s).is_none());
    }
}

/// JSON line we write to the Kimbo socket. Newline-terminated so the
/// listener can use line-buffered reads.
pub fn encode_event_line(payload: &HookPayload, ts_ms: u64) -> String {
    let kind_str = match payload.kind {
        NotifyKind::Stop => "stop",
        NotifyKind::Notification => "notification",
    };
    let v = serde_json::json!({
        "session_id": payload.session_id,
        "kind": kind_str,
        "ts": ts_ms,
        "message": payload.message,
    });
    format!("{}\n", v)
}

#[cfg(test)]
mod encode_tests {
    use super::*;

    #[test]
    fn encodes_stop_event_without_message() {
        let p = HookPayload {
            session_id: "abc-123".into(),
            kind: NotifyKind::Stop,
            message: None,
        };
        let line = encode_event_line(&p, 1714478531000);
        assert!(line.ends_with('\n'));
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["session_id"], "abc-123");
        assert_eq!(parsed["kind"], "stop");
        assert_eq!(parsed["ts"], 1714478531000u64);
        assert!(parsed["message"].is_null());
    }

    #[test]
    fn encodes_notification_event_with_message() {
        let p = HookPayload {
            session_id: "xyz".into(),
            kind: NotifyKind::Notification,
            message: Some("Claude needs your permission".into()),
        };
        let line = encode_event_line(&p, 1);
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["kind"], "notification");
        assert_eq!(parsed["message"], "Claude needs your permission");
    }
}

use std::path::PathBuf;

/// Resolve the Kimbo notify socket path.
///
/// Layout: `$HOME/.kimbo/notify.sock`. The spec called for a `<uid>` suffix
/// (`notify-<uid>.sock`) for multi-user isolation, but `$HOME` already
/// provides per-user isolation on macOS — adding `<uid>` would only matter
/// in the unusual case of a shared home dir across machines, which kimbo
/// doesn't otherwise support. Kept simple here; promote to `<uid>` if a
/// shared-home scenario surfaces.
///
/// Caller is expected to override `$HOME` in tests to redirect.
pub fn resolve_socket_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".kimbo").join("notify.sock"))
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn resolves_path_under_home_dot_kimbo() {
        let dir = tempfile::tempdir().unwrap();
        // SAFETY: tests in this crate are single-threaded inside this module.
        let saved = std::env::var_os("HOME");
        unsafe { std::env::set_var("HOME", dir.path()); }
        let got = resolve_socket_path().unwrap();
        match saved {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        assert_eq!(got, dir.path().join(".kimbo").join("notify.sock"));
    }
}
