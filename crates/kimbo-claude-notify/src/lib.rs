//! `kimbo-claude-notify` — tiny sidecar invoked by Claude Code's `Stop` and
//! `Notification` hooks. Reads the hook JSON payload from stdin, forwards a
//! one-line JSON event to the Kimbo backend over a Unix domain socket, exits.
//!
//! Designed to NEVER break the user's Claude session: any failure (kimbo not
//! running, malformed payload, socket gone) results in a silent exit 0.

use serde::{Deserialize, Serialize};

/// What we extract from Claude Code's hook stdin payload. Both `Stop` and
/// `Notification` hooks send the same envelope; only `hook_event_name`
/// differs. `message` is only set on `Notification` hooks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookPayload {
    pub session_id: String,
    pub kind: NotifyKind,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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
}
