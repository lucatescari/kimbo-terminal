//! Claude rate-limit cache command + install/uninstall support.
//!
//! See `docs/superpowers/specs/2026-04-30-claude-rate-limits-hud-design.md`.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

// RateLimits / LimitWindow live in the sidecar lib so the cache schema has a
// single source of truth. Re-export so callers in this crate can use them.
#[allow(unused_imports)]
pub use kimbo_claude_statusline::{LimitWindow, RateLimits};

#[allow(dead_code)]
fn cache_path() -> PathBuf {
    kimbo_config::AppConfig::config_dir().join("claude-rate-limits.json")
}

/// Read the cache file. Returns `None` when missing or corrupt; never panics.
#[allow(dead_code)]
pub fn read_cache_at(path: &Path) -> Option<RateLimits> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice::<RateLimits>(&bytes) {
        Ok(r) => Some(r),
        Err(e) => {
            eprintln!("claude_rate_limits: cache parse failed: {e}");
            None
        }
    }
}

#[tauri::command]
#[allow(dead_code)]
pub fn claude_rate_limits() -> Result<Option<RateLimits>, String> {
    Ok(read_cache_at(&cache_path()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
#[allow(dead_code)]
pub enum InstallAction {
    InstallSilently,
    AlreadyOurs,
    AskFirst { existing: String },
}

/// Pure planner: given the current contents of `~/.claude/settings.json`
/// (or `None` if the file doesn't exist) and the absolute path our wrapper
/// would be installed at, decide what to do.
#[allow(dead_code)]
pub fn decide_install_action(settings_json: Option<&str>, our_wrapper_path: &str) -> InstallAction {
    let raw = match settings_json {
        Some(s) => s,
        None => return InstallAction::InstallSilently,
    };
    let v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return InstallAction::InstallSilently,
    };
    let cmd = v.pointer("/statusLine/command").and_then(|x| x.as_str());
    match cmd {
        None => InstallAction::InstallSilently,
        Some(c) if c == our_wrapper_path => InstallAction::AlreadyOurs,
        Some(c) => InstallAction::AskFirst { existing: c.to_string() },
    }
}

#[cfg(test)]
mod planner_tests {
    use super::*;

    #[test]
    fn no_settings_file_means_install_silently() {
        assert_eq!(
            decide_install_action(None, "/x/wrapper.sh"),
            InstallAction::InstallSilently
        );
    }

    #[test]
    fn empty_settings_means_install_silently() {
        assert_eq!(
            decide_install_action(Some("{}"), "/x/wrapper.sh"),
            InstallAction::InstallSilently
        );
    }

    #[test]
    fn no_status_line_key_means_install_silently() {
        assert_eq!(
            decide_install_action(Some(r#"{"theme":"dark"}"#), "/x/wrapper.sh"),
            InstallAction::InstallSilently
        );
    }

    #[test]
    fn existing_command_matching_our_path_is_already_ours() {
        let s = r#"{"statusLine":{"type":"command","command":"/x/wrapper.sh"}}"#;
        assert_eq!(
            decide_install_action(Some(s), "/x/wrapper.sh"),
            InstallAction::AlreadyOurs
        );
    }

    #[test]
    fn different_existing_command_returns_ask_first() {
        let s = r#"{"statusLine":{"type":"command","command":"/usr/local/bin/my-bar"}}"#;
        assert_eq!(
            decide_install_action(Some(s), "/x/wrapper.sh"),
            InstallAction::AskFirst { existing: "/usr/local/bin/my-bar".into() }
        );
    }

    #[test]
    fn malformed_settings_treated_as_empty() {
        // We don't want to refuse install just because the user's JSON is broken.
        assert_eq!(
            decide_install_action(Some("not json"), "/x/wrapper.sh"),
            InstallAction::InstallSilently
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
#[allow(dead_code)]
pub enum InstallOutcome {
    Installed,
    Pending { existing: String },
    NoOp,
}

#[allow(dead_code)]
const STATUSLINE_BACKUP_FILE: &str = "claude-statusline-backup.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct StatusLineBackup {
    saved_at_ms: u64,
    original_status_line: serde_json::Value,
}

/// Pure: produce the wrapper script body given absolute paths.
#[allow(dead_code)]
pub fn render_wrapper_script(sidecar_abs_path: &str, app_data_abs_path: &str) -> String {
    format!(
        "#!/bin/sh\n# Kimbo Claude statusline wrapper — auto-generated, do not edit.\n# Rewritten by kimbo on every launch with the current sidecar path.\nKIMBO_APP_DATA=\"{app_data_abs_path}\" \\\n    exec \"{sidecar_abs_path}\" \"$@\"\n"
    )
}

/// Pure: given current settings.json content and a wrapper path, return the
/// new settings.json content with our statusLine installed. Preserves all
/// other keys verbatim.
#[allow(dead_code)]
pub fn install_into_settings(current: Option<&str>, wrapper_path: &str) -> Result<String, String> {
    let mut v: serde_json::Value = match current {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({})),
        _ => serde_json::json!({}),
    };
    let map = v.as_object_mut().ok_or_else(|| "settings.json root is not an object".to_string())?;
    map.insert(
        "statusLine".to_string(),
        serde_json::json!({ "type": "command", "command": wrapper_path }),
    );
    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

/// Pure: produce the settings JSON with our statusLine entry removed; or the
/// backup's original_status_line restored if a backup is provided.
#[allow(dead_code)]
pub fn uninstall_from_settings(
    current: Option<&str>,
    backup: Option<&StatusLineBackup>,
) -> Result<String, String> {
    let mut v: serde_json::Value = match current {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({})),
        _ => serde_json::json!({}),
    };
    let map = v.as_object_mut().ok_or_else(|| "settings.json root is not an object".to_string())?;
    match backup {
        Some(b) => {
            map.insert("statusLine".to_string(), b.original_status_line.clone());
        }
        None => {
            map.remove("statusLine");
        }
    }
    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

#[cfg(test)]
mod install_tests {
    use super::*;

    #[test]
    fn render_wrapper_script_is_executable_sh_with_env_and_exec() {
        let s = render_wrapper_script("/Apps/Kimbo.app/Contents/Resources/kimbo-claude-statusline", "/Users/u/Library/Application Support/kimbo");
        assert!(s.starts_with("#!/bin/sh\n"));
        assert!(s.contains("KIMBO_APP_DATA=\"/Users/u/Library/Application Support/kimbo\""));
        assert!(s.contains("exec \"/Apps/Kimbo.app/Contents/Resources/kimbo-claude-statusline\""));
        assert!(s.contains("\"$@\""));
    }

    #[test]
    fn install_into_empty_settings_creates_status_line() {
        let out = install_into_settings(None, "/x/wrapper.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v.pointer("/statusLine/type").and_then(|x| x.as_str()), Some("command"));
        assert_eq!(v.pointer("/statusLine/command").and_then(|x| x.as_str()), Some("/x/wrapper.sh"));
    }

    #[test]
    fn install_preserves_other_settings() {
        let original = r#"{"theme":"dark","apiKey":"xyz"}"#;
        let out = install_into_settings(Some(original), "/x/wrapper.sh").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v.get("theme").and_then(|x| x.as_str()), Some("dark"));
        assert_eq!(v.get("apiKey").and_then(|x| x.as_str()), Some("xyz"));
    }

    #[test]
    fn uninstall_without_backup_removes_status_line() {
        let original = r#"{"theme":"dark","statusLine":{"type":"command","command":"/x/wrapper.sh"}}"#;
        let out = uninstall_from_settings(Some(original), None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("statusLine").is_none());
        assert_eq!(v.get("theme").and_then(|x| x.as_str()), Some("dark"));
    }

    #[test]
    fn uninstall_with_backup_restores_original_status_line() {
        let original = r#"{"statusLine":{"type":"command","command":"/x/wrapper.sh"}}"#;
        let backup = StatusLineBackup {
            saved_at_ms: 0,
            original_status_line: serde_json::json!({"type":"command","command":"/usr/local/bin/my-bar"}),
        };
        let out = uninstall_from_settings(Some(original), Some(&backup)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v.pointer("/statusLine/command").and_then(|x| x.as_str()), Some("/usr/local/bin/my-bar"));
    }

    #[test]
    fn install_uninstall_roundtrip_with_backup_returns_to_start() {
        let original = r#"{"statusLine":{"type":"command","command":"/usr/local/bin/my-bar"}}"#;
        let installed = install_into_settings(Some(original), "/x/wrapper.sh").unwrap();
        let original_value: serde_json::Value = serde_json::from_str(original).unwrap();
        let backup = StatusLineBackup {
            saved_at_ms: 0,
            original_status_line: original_value.get("statusLine").cloned().unwrap(),
        };
        let restored = uninstall_from_settings(Some(&installed), Some(&backup)).unwrap();
        let restored_v: serde_json::Value = serde_json::from_str(&restored).unwrap();
        let original_v: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(restored_v.get("statusLine"), original_v.get("statusLine"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn sample() -> RateLimits {
        RateLimits {
            five_hour: Some(LimitWindow { used_percentage: 47, resets_at: "2026-04-30T18:00:00Z".into() }),
            seven_day: Some(LimitWindow { used_percentage: 23, resets_at: "2026-05-04T00:00:00Z".into() }),
            captured_at_ms: 1714478531000,
            account_email: Some("luca@tescari.dev".into()),
            version_too_old: false,
        }
    }

    #[test]
    fn read_cache_returns_none_when_file_missing() {
        let dir = tempdir().unwrap();
        assert!(read_cache_at(&dir.path().join("nope.json")).is_none());
    }

    #[test]
    fn read_cache_returns_struct_on_valid_file() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("c.json");
        fs::write(&p, serde_json::to_vec(&sample()).unwrap()).unwrap();
        assert_eq!(read_cache_at(&p), Some(sample()));
    }

    #[test]
    fn read_cache_returns_none_on_corrupt_file() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("c.json");
        fs::write(&p, b"{ not valid json").unwrap();
        assert!(read_cache_at(&p).is_none());
    }
}

#[allow(dead_code)]
fn home_dir() -> std::io::Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))
}

#[allow(dead_code)]
fn settings_path() -> std::io::Result<PathBuf> {
    Ok(home_dir()?.join(".claude").join("settings.json"))
}

#[allow(dead_code)]
fn wrapper_path() -> std::io::Result<PathBuf> {
    Ok(home_dir()?.join(".claude").join("kimbo-statusline.sh"))
}

#[allow(dead_code)]
fn backup_path() -> PathBuf {
    kimbo_config::AppConfig::config_dir().join(STATUSLINE_BACKUP_FILE)
}

#[allow(dead_code)]
fn read_optional(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok()
}

#[allow(dead_code)]
fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
#[allow(dead_code)]
pub fn claude_rate_limits_install(
    force: bool,
    sidecar_abs_path: String,
) -> Result<InstallOutcome, String> {
    let settings_p = settings_path().map_err(|e| e.to_string())?;
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    let app_data = kimbo_config::AppConfig::config_dir();

    let current = read_optional(&settings_p);
    let action = decide_install_action(current.as_deref(), wrapper_p.to_string_lossy().as_ref());

    match action {
        InstallAction::AlreadyOurs => return Ok(InstallOutcome::NoOp),
        InstallAction::AskFirst { existing } if !force => {
            return Ok(InstallOutcome::Pending { existing });
        }
        InstallAction::AskFirst { .. } => {
            // Save backup before clobbering.
            if let Some(s) = current.as_deref() {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s) {
                    if let Some(prior) = parsed.get("statusLine").cloned() {
                        let backup = StatusLineBackup { saved_at_ms: now_ms(), original_status_line: prior };
                        let bp = backup_path();
                        std::fs::create_dir_all(bp.parent().unwrap()).map_err(|e| e.to_string())?;
                        std::fs::write(&bp, serde_json::to_vec_pretty(&backup).unwrap()).map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        InstallAction::InstallSilently => {}
    }

    // Write wrapper script.
    let body = render_wrapper_script(&sidecar_abs_path, app_data.to_string_lossy().as_ref());
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
    let new_settings = install_into_settings(current.as_deref(), wrapper_p.to_string_lossy().as_ref())?;
    std::fs::create_dir_all(settings_p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&settings_p, new_settings).map_err(|e| e.to_string())?;

    Ok(InstallOutcome::Installed)
}

#[tauri::command]
#[allow(dead_code)]
pub fn claude_rate_limits_uninstall() -> Result<(), String> {
    let settings_p = settings_path().map_err(|e| e.to_string())?;
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    let backup_p = backup_path();

    let current = read_optional(&settings_p);
    let backup: Option<StatusLineBackup> = read_optional(&backup_p)
        .and_then(|s| serde_json::from_str(&s).ok());

    let new_settings = uninstall_from_settings(current.as_deref(), backup.as_ref())?;
    std::fs::write(&settings_p, new_settings).map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&wrapper_p);
    let _ = std::fs::remove_file(&backup_p);
    Ok(())
}

/// Called from app setup on every kimbo launch when the feature is enabled,
/// to refresh the wrapper with the currently-resolved sidecar path.
#[allow(dead_code)]
pub fn rewrite_wrapper(sidecar_abs_path: &str) -> Result<(), String> {
    let wrapper_p = wrapper_path().map_err(|e| e.to_string())?;
    if !wrapper_p.exists() {
        return Ok(()); // not installed; nothing to refresh
    }
    let app_data = kimbo_config::AppConfig::config_dir();
    let body = render_wrapper_script(sidecar_abs_path, app_data.to_string_lossy().as_ref());
    std::fs::write(&wrapper_p, body).map_err(|e| e.to_string())
}
