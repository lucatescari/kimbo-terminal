//! Install / uninstall the `Stop` and `Notification` hooks for
//! `kimbo-claude-notify` in `~/.claude/settings.json`.
//!
//! See `docs/superpowers/specs/2026-05-07-claude-pane-notifications-design.md`.

use serde::{Deserialize, Serialize};

const HOOK_EVENTS: &[&str] = &["Stop", "Notification"];

/// Pure: insert hook entries pointing to `wrapper_path` for both `Stop` and
/// `Notification` event arrays. Idempotent — entries already pointing at our
/// path are not duplicated. Other entries (other tools' hooks) are preserved.
///
/// Returns the new pretty-printed settings JSON.
pub fn install_hooks_into_settings(current: Option<&str>, wrapper_path: &str) -> Result<String, String> {
    let mut v: serde_json::Value = match current {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({})),
        _ => serde_json::json!({}),
    };
    let map = v.as_object_mut().ok_or_else(|| "settings.json root is not an object".to_string())?;
    let hooks = map
        .entry("hooks".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| "settings.json `hooks` is not an object".to_string())?;

    for &event in HOOK_EVENTS {
        let arr = hooks
            .entry(event.to_string())
            .or_insert_with(|| serde_json::json!([]));
        let arr = arr
            .as_array_mut()
            .ok_or_else(|| format!("settings.json `hooks.{event}` is not an array"))?;

        if arr.iter().any(|entry| entry_points_to(entry, wrapper_path)) {
            continue;
        }

        arr.push(serde_json::json!({
            "hooks": [
                { "type": "command", "command": wrapper_path }
            ]
        }));
    }

    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

/// Pure: remove only entries whose nested command equals `wrapper_path`.
/// Other entries survive verbatim; empty `hooks.{event}` arrays are removed.
pub fn uninstall_hooks_from_settings(current: Option<&str>, wrapper_path: &str) -> Result<String, String> {
    let mut v: serde_json::Value = match current {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({})),
        _ => serde_json::json!({}),
    };
    let map = v.as_object_mut().ok_or_else(|| "settings.json root is not an object".to_string())?;

    if let Some(hooks_v) = map.get_mut("hooks") {
        if let Some(hooks) = hooks_v.as_object_mut() {
            for &event in HOOK_EVENTS {
                if let Some(arr) = hooks.get_mut(event).and_then(|a| a.as_array_mut()) {
                    arr.retain(|entry| !entry_points_to(entry, wrapper_path));
                    if arr.is_empty() {
                        hooks.remove(event);
                    }
                }
            }
            if hooks.is_empty() {
                map.remove("hooks");
            }
        }
    }

    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

fn entry_points_to(entry: &serde_json::Value, wrapper_path: &str) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|inner| {
            inner.iter().any(|h| {
                h.get("command").and_then(|c| c.as_str()) == Some(wrapper_path)
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod install_tests {
    use super::*;

    #[test]
    fn install_into_empty_settings_creates_both_hook_arrays() {
        let out = install_hooks_into_settings(None, "/x/notify.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let stop = v.pointer("/hooks/Stop").unwrap().as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert_eq!(
            stop[0].pointer("/hooks/0/command").and_then(|c| c.as_str()),
            Some("/x/notify.sh")
        );
        let notif = v.pointer("/hooks/Notification").unwrap().as_array().unwrap();
        assert_eq!(notif.len(), 1);
    }

    #[test]
    fn install_is_idempotent() {
        let once = install_hooks_into_settings(None, "/x/notify.sh").unwrap();
        let twice = install_hooks_into_settings(Some(&once), "/x/notify.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&twice).unwrap();
        let stop = v.pointer("/hooks/Stop").unwrap().as_array().unwrap();
        assert_eq!(stop.len(), 1, "second install must not duplicate the entry");
    }

    #[test]
    fn install_preserves_other_user_entries() {
        let original = r#"{
            "theme": "dark",
            "hooks": {
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "/usr/local/bin/their-tool" }] }
                ],
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "/x/other" }] }
                ]
            }
        }"#;
        let out = install_hooks_into_settings(Some(original), "/x/notify.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v.get("theme").and_then(|x| x.as_str()), Some("dark"));
        let stop = v.pointer("/hooks/Stop").unwrap().as_array().unwrap();
        assert_eq!(stop.len(), 2, "their entry + ours");
        assert!(v.pointer("/hooks/PreToolUse").is_some(), "unrelated event survives");
    }

    #[test]
    fn uninstall_removes_only_our_entries() {
        let after_install = install_hooks_into_settings(
            Some(r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/usr/local/bin/their-tool"}]}]}}"#),
            "/x/notify.sh",
        ).unwrap();
        let out = uninstall_hooks_from_settings(Some(&after_install), "/x/notify.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let stop = v.pointer("/hooks/Stop").unwrap().as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert_eq!(
            stop[0].pointer("/hooks/0/command").and_then(|c| c.as_str()),
            Some("/usr/local/bin/their-tool")
        );
        assert!(v.pointer("/hooks/Notification").is_none());
    }

    #[test]
    fn uninstall_drops_empty_hooks_block_entirely() {
        let after_install = install_hooks_into_settings(None, "/x/notify.sh").unwrap();
        let out = uninstall_hooks_from_settings(Some(&after_install), "/x/notify.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("hooks").is_none(), "hooks key removed when empty");
    }

    #[test]
    fn install_uninstall_roundtrip_returns_to_original() {
        let original = r#"{"theme":"dark"}"#;
        let installed = install_hooks_into_settings(Some(original), "/x/notify.sh").unwrap();
        let restored = uninstall_hooks_from_settings(Some(&installed), "/x/notify.sh").unwrap();
        let restored_v: serde_json::Value = serde_json::from_str(&restored).unwrap();
        let original_v: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(restored_v, original_v);
    }

    #[test]
    fn malformed_settings_treated_as_empty() {
        let out = install_hooks_into_settings(Some("not json"), "/x/notify.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.pointer("/hooks/Stop").is_some());
    }
}
