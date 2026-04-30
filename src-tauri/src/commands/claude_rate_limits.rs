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
