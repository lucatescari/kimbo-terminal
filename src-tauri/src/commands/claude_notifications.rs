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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum InstallStatus {
    Installed,
    PartiallyInstalled { missing: Vec<String> },
    NotInstalled,
    Unknown,
}

/// Pure: classify the install state by checking whether `wrapper_path` is
/// present in BOTH `hooks.Stop` and `hooks.Notification` arrays.
pub fn compute_status(current: Option<&str>, wrapper_path: &str) -> InstallStatus {
    let raw = match current {
        Some(s) if !s.trim().is_empty() => s,
        _ => return InstallStatus::NotInstalled,
    };
    let v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return InstallStatus::Unknown,
    };

    let mut missing: Vec<String> = Vec::new();
    for &event in HOOK_EVENTS {
        let present = v
            .pointer(&format!("/hooks/{event}"))
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().any(|entry| entry_points_to(entry, wrapper_path)))
            .unwrap_or(false);
        if !present {
            missing.push(event.to_string());
        }
    }

    match missing.len() {
        0 => InstallStatus::Installed,
        n if n == HOOK_EVENTS.len() => InstallStatus::NotInstalled,
        _ => InstallStatus::PartiallyInstalled { missing },
    }
}

#[cfg(test)]
mod status_tests {
    use super::*;

    #[test]
    fn missing_settings_is_not_installed() {
        assert_eq!(compute_status(None, "/x/notify.sh"), InstallStatus::NotInstalled);
        assert_eq!(compute_status(Some(""), "/x/notify.sh"), InstallStatus::NotInstalled);
        assert_eq!(compute_status(Some("{}"), "/x/notify.sh"), InstallStatus::NotInstalled);
    }

    #[test]
    fn malformed_settings_is_unknown() {
        assert_eq!(compute_status(Some("not json"), "/x/notify.sh"), InstallStatus::Unknown);
    }

    #[test]
    fn both_hooks_present_is_installed() {
        let installed = install_hooks_into_settings(None, "/x/notify.sh").unwrap();
        assert_eq!(compute_status(Some(&installed), "/x/notify.sh"), InstallStatus::Installed);
    }

    #[test]
    fn only_one_hook_present_is_partial() {
        let s = r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/x/notify.sh"}]}]}}"#;
        match compute_status(Some(s), "/x/notify.sh") {
            InstallStatus::PartiallyInstalled { missing } => {
                assert_eq!(missing, vec!["Notification".to_string()]);
            }
            other => panic!("expected PartiallyInstalled, got {other:?}"),
        }
    }
}

use std::path::{Path, PathBuf};

/// Pure: produce the wrapper script body for a given absolute sidecar path.
/// The wrapper is what we put in `~/.claude/settings.json` so the path stored
/// there stays stable across kimbo updates; each launch we rewrite the
/// wrapper to point at the current sidecar location.
pub fn render_wrapper_script(sidecar_abs_path: &str) -> String {
    format!(
        "#!/bin/sh\n# Kimbo Claude notify wrapper — auto-generated, do not edit.\n# Rewritten by kimbo on every launch with the current sidecar path.\nexec \"{sidecar_abs_path}\" \"$@\"\n"
    )
}

fn home_dir() -> std::io::Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))
}

pub fn settings_path() -> std::io::Result<PathBuf> {
    Ok(home_dir()?.join(".claude").join("settings.json"))
}

pub fn wrapper_path() -> std::io::Result<PathBuf> {
    Ok(home_dir()?.join(".claude").join("kimbo-notify.sh"))
}

/// Resolve the bundled `kimbo-claude-notify` sidecar relative to the running
/// kimbo executable. Same scheme as `claude_rate_limits::sidecar_path`.
pub fn sidecar_path() -> std::io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "current_exe has no parent")
    })?;
    let bin_name = if cfg!(windows) {
        "kimbo-claude-notify.exe"
    } else {
        "kimbo-claude-notify"
    };
    Ok(dir.join(bin_name))
}

fn read_optional(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok()
}

#[cfg(test)]
mod wrapper_tests {
    use super::*;

    #[test]
    fn render_wrapper_script_is_executable_sh_with_exec() {
        let s = render_wrapper_script("/Apps/Kimbo.app/Contents/MacOS/kimbo-claude-notify");
        assert!(s.starts_with("#!/bin/sh\n"));
        assert!(s.contains("exec \"/Apps/Kimbo.app/Contents/MacOS/kimbo-claude-notify\""));
        assert!(s.contains("\"$@\""));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum InstallOutcome {
    Installed,
    NoOp,
}

#[tauri::command]
pub fn claude_notifications_install(_app: tauri::AppHandle) -> Result<InstallOutcome, String> {
    let sidecar = sidecar_path().map_err(|e| format!("resolve sidecar: {e}"))?;
    let sidecar_abs = sidecar.to_string_lossy().to_string();
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    let settings_p = settings_path().map_err(|e| e.to_string())?;

    let current = read_optional(&settings_p);
    let was_already = matches!(
        compute_status(current.as_deref(), wrapper_p.to_string_lossy().as_ref()),
        InstallStatus::Installed
    );

    // Write/refresh wrapper.
    let body = render_wrapper_script(&sidecar_abs);
    std::fs::create_dir_all(wrapper_p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&wrapper_p, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&wrapper_p).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&wrapper_p, perms).map_err(|e| e.to_string())?;
    }

    // Patch settings.json.
    let new_settings = install_hooks_into_settings(
        current.as_deref(),
        wrapper_p.to_string_lossy().as_ref(),
    )?;
    std::fs::create_dir_all(settings_p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&settings_p, new_settings).map_err(|e| e.to_string())?;

    Ok(if was_already { InstallOutcome::NoOp } else { InstallOutcome::Installed })
}

#[tauri::command]
pub fn claude_notifications_uninstall() -> Result<(), String> {
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    let settings_p = settings_path().map_err(|e| e.to_string())?;

    let current = read_optional(&settings_p);
    if current.is_some() {
        let new_settings = uninstall_hooks_from_settings(
            current.as_deref(),
            wrapper_p.to_string_lossy().as_ref(),
        )?;
        std::fs::write(&settings_p, new_settings).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&wrapper_p);
    Ok(())
}

#[tauri::command]
pub fn claude_notifications_status() -> Result<InstallStatus, String> {
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    let settings_p = settings_path().map_err(|e| e.to_string())?;
    let current = read_optional(&settings_p);
    Ok(compute_status(current.as_deref(), wrapper_p.to_string_lossy().as_ref()))
}

/// Called from app setup on every launch. If the wrapper exists, rewrite it
/// so its `exec` line points at the currently-installed sidecar (handles
/// kimbo upgrades that move the bundled binary).
pub fn rewrite_wrapper(sidecar_abs_path: &str) -> Result<(), String> {
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    if !wrapper_p.exists() {
        return Ok(());
    }
    let body = render_wrapper_script(sidecar_abs_path);
    std::fs::write(&wrapper_p, body).map_err(|e| e.to_string())
}
