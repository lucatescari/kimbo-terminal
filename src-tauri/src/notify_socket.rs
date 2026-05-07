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
