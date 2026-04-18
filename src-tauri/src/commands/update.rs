//! Update check: compares the current build version against the latest
//! GitHub release of `lucatescari/kimbo-terminal` and reports whether a
//! newer build is available. The result is cached for the lifetime of
//! the process — the user can force a refresh from the About settings tab.

use serde::Serialize;
use std::sync::Mutex;

/// Information about the latest release vs. the current build.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    /// Current build version (from `CARGO_PKG_VERSION`), e.g. "0.2.1".
    pub current: String,
    /// Latest release tag with any leading `v` stripped, e.g. "0.3.0".
    pub latest: String,
    /// True if `latest` parses as a strictly greater semver than `current`.
    pub is_newer: bool,
    /// `html_url` from the GitHub release JSON (the human-readable page).
    pub release_url: String,
    /// `published_at` from the release JSON (ISO 8601, passed through verbatim).
    pub published_at: String,
    /// Release notes (`body` field, raw markdown).
    pub notes: String,
}

/// Strip a leading `v` (case-insensitive) so `v0.3.0` parses as semver.
fn strip_v_prefix(tag: &str) -> &str {
    tag.strip_prefix('v').or_else(|| tag.strip_prefix('V')).unwrap_or(tag)
}

/// Compare two version strings. Returns `true` iff `latest > current` per semver.
/// Logs a warning and returns `false` if either side fails to parse.
pub(crate) fn is_newer(current: &str, latest: &str) -> bool {
    let current_v = match semver::Version::parse(strip_v_prefix(current)) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("failed to parse current version '{}': {}", current, e);
            return false;
        }
    };
    let latest_v = match semver::Version::parse(strip_v_prefix(latest)) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("failed to parse latest version '{}': {}", latest, e);
            return false;
        }
    };
    latest_v > current_v
}

/// Process-lifetime cache of the latest successful check. Tauri-managed.
#[derive(Default)]
pub struct UpdateState {
    pub cache: Mutex<Option<UpdateInfo>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_newer_strips_v_prefix() {
        assert!(is_newer("0.2.1", "v0.3.0"));
        assert!(is_newer("v0.2.1", "0.3.0"));
    }

    #[test]
    fn is_newer_equal_versions() {
        assert!(!is_newer("0.2.1", "0.2.1"));
        assert!(!is_newer("v0.2.1", "v0.2.1"));
    }

    #[test]
    fn is_newer_older_remote() {
        assert!(!is_newer("0.2.1", "0.1.0"));
        assert!(!is_newer("0.2.1", "v0.2.0"));
    }

    #[test]
    fn is_newer_invalid_semver() {
        // No panic — just `false`.
        assert!(!is_newer("garbage", "0.3.0"));
        assert!(!is_newer("0.2.1", "garbage"));
        assert!(!is_newer("not-a-version", "still-not"));
    }
}
