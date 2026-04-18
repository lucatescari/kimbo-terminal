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

/// Subset of the GitHub release JSON we use. Fields outside this set are
/// ignored by serde — see the GitHub REST docs for the full schema.
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct GhRelease {
    pub tag_name: String,
    pub draft: bool,
    pub prerelease: bool,
    pub html_url: String,
    pub published_at: Option<String>,
    pub body: String,
}

/// Parse a single `/releases/latest` response.
pub(crate) fn parse_single_release(json: &str) -> Result<GhRelease, String> {
    serde_json::from_str::<GhRelease>(json).map_err(|e| format!("malformed release: {}", e))
}

/// Parse a `/releases?per_page=N` list and return the first non-draft, non-prerelease item.
pub(crate) fn pick_first_stable(json: &str) -> Result<GhRelease, String> {
    let releases: Vec<GhRelease> =
        serde_json::from_str(json).map_err(|e| format!("malformed release list: {}", e))?;
    releases
        .into_iter()
        .find(|r| !r.draft && !r.prerelease)
        .ok_or_else(|| "no stable release found in latest 10".to_string())
}

/// Convert a parsed release + the current build version into an `UpdateInfo`.
pub(crate) fn build_update_info(current: &str, release: GhRelease) -> UpdateInfo {
    let latest = strip_v_prefix(&release.tag_name).to_string();
    let is_newer = is_newer(current, &release.tag_name);
    UpdateInfo {
        current: current.to_string(),
        latest,
        is_newer,
        release_url: release.html_url,
        published_at: release.published_at.unwrap_or_default(),
        notes: release.body,
    }
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

    const STABLE_RELEASE_JSON: &str = "{\
        \"tag_name\": \"v0.3.0\",\
        \"draft\": false,\
        \"prerelease\": false,\
        \"html_url\": \"https://github.com/lucatescari/kimbo-terminal/releases/tag/v0.3.0\",\
        \"published_at\": \"2026-04-15T10:00:00Z\",\
        \"body\": \"## What's new\\n- Faster splits\\n- Bug fixes\"\
    }";

    const PRERELEASE_LIST_JSON: &str = "[\
        {\
            \"tag_name\": \"v0.4.0-beta\",\
            \"draft\": false,\
            \"prerelease\": true,\
            \"html_url\": \"https://example.com/beta\",\
            \"published_at\": \"2026-04-17T00:00:00Z\",\
            \"body\": \"beta\"\
        },\
        {\
            \"tag_name\": \"v0.3.0\",\
            \"draft\": false,\
            \"prerelease\": false,\
            \"html_url\": \"https://github.com/lucatescari/kimbo-terminal/releases/tag/v0.3.0\",\
            \"published_at\": \"2026-04-15T10:00:00Z\",\
            \"body\": \"stable notes\"\
        },\
        {\
            \"tag_name\": \"v0.2.1\",\
            \"draft\": false,\
            \"prerelease\": false,\
            \"html_url\": \"https://example.com/old\",\
            \"published_at\": \"2026-03-01T00:00:00Z\",\
            \"body\": \"old\"\
        }\
    ]";

    const DRAFT_THEN_STABLE_JSON: &str = "[\
        {\
            \"tag_name\": \"v0.5.0\",\
            \"draft\": true,\
            \"prerelease\": false,\
            \"html_url\": \"https://example.com/draft\",\
            \"published_at\": null,\
            \"body\": \"draft\"\
        },\
        {\
            \"tag_name\": \"v0.3.0\",\
            \"draft\": false,\
            \"prerelease\": false,\
            \"html_url\": \"https://github.com/lucatescari/kimbo-terminal/releases/tag/v0.3.0\",\
            \"published_at\": \"2026-04-15T10:00:00Z\",\
            \"body\": \"stable\"\
        }\
    ]";

    #[test]
    fn parse_release_extracts_fields() {
        let r = parse_single_release(STABLE_RELEASE_JSON).unwrap();
        assert_eq!(r.tag_name, "v0.3.0");
        assert_eq!(r.html_url, "https://github.com/lucatescari/kimbo-terminal/releases/tag/v0.3.0");
        assert_eq!(r.published_at.as_deref(), Some("2026-04-15T10:00:00Z"));
        assert!(r.body.contains("Faster splits"));
        assert!(!r.draft);
        assert!(!r.prerelease);
    }

    #[test]
    fn parse_release_rejects_invalid_json() {
        assert!(parse_single_release("not json").is_err());
    }

    #[test]
    fn pick_first_stable_skips_prereleases_and_drafts() {
        let picked = pick_first_stable(PRERELEASE_LIST_JSON).unwrap();
        assert_eq!(picked.tag_name, "v0.3.0");
        assert_eq!(picked.body, "stable notes");
    }

    #[test]
    fn pick_first_stable_skips_drafts() {
        let picked = pick_first_stable(DRAFT_THEN_STABLE_JSON).unwrap();
        assert_eq!(picked.tag_name, "v0.3.0");
    }

    #[test]
    fn pick_first_stable_errors_when_none_available() {
        let only_prereleases = r#"[
            {"tag_name":"v1.0.0-beta","draft":false,"prerelease":true,"html_url":"x","published_at":null,"body":""}
        ]"#;
        assert!(pick_first_stable(only_prereleases).is_err());
    }

    #[test]
    fn build_update_info_from_release() {
        let r = parse_single_release(STABLE_RELEASE_JSON).unwrap();
        let info = build_update_info("0.2.1", r);
        assert_eq!(info.current, "0.2.1");
        assert_eq!(info.latest, "0.3.0"); // `v` stripped
        assert!(info.is_newer);
        assert_eq!(info.release_url, "https://github.com/lucatescari/kimbo-terminal/releases/tag/v0.3.0");
        assert_eq!(info.published_at, "2026-04-15T10:00:00Z");
        assert!(info.notes.contains("Faster splits"));
    }

    #[test]
    fn build_update_info_handles_missing_published_at() {
        let json = r#"{
            "tag_name": "v0.3.0",
            "draft": false,
            "prerelease": false,
            "html_url": "https://example.com/r",
            "published_at": null,
            "body": ""
        }"#;
        let r = parse_single_release(json).unwrap();
        let info = build_update_info("0.2.1", r);
        assert_eq!(info.published_at, "");
    }
}
