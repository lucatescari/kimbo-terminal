//! Claude rate-limit cache command + install/uninstall support.
//!
//! See `docs/superpowers/specs/2026-04-30-claude-rate-limits-hud-design.md`.

use std::path::{Path, PathBuf};

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

use serde::{Deserialize, Serialize};

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
