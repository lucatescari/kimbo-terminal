use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LimitWindow {
    pub used_percentage: u8,
    pub resets_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ParsedInput {
    pub five_hour: Option<LimitWindow>,
    pub seven_day: Option<LimitWindow>,
    pub account_email: Option<String>,
    pub version_too_old: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RateLimits {
    pub five_hour: Option<LimitWindow>,
    pub seven_day: Option<LimitWindow>,
    pub captured_at_ms: u64,
    pub account_email: Option<String>,
    pub version_too_old: bool,
}

/// Write the cache file atomically (write to .tmp sibling, then rename).
pub fn write_cache(path: &Path, cache: &RateLimits) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(cache)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Parse the JSON Claude Code pipes into the statusLine command.
/// Returns `Err` only on malformed JSON. Missing optional fields are tolerated.
pub fn parse_input(stdin: &str) -> Result<ParsedInput, serde_json::Error> {
    let v: serde_json::Value = serde_json::from_str(stdin)?;

    let rate_limits = v.get("rate_limits");
    let version_too_old = rate_limits.is_none();

    let extract_window = |key: &str| -> Option<LimitWindow> {
        let w = rate_limits?.get(key)?;
        Some(LimitWindow {
            used_percentage: w.get("used_percentage")?.as_u64()?.min(255) as u8,
            resets_at: w.get("resets_at")?.as_str()?.to_string(),
        })
    };

    let account_email = v
        .pointer("/workspace/account_email")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("email").and_then(|x| x.as_str()))
        .map(str::to_string);

    Ok(ParsedInput {
        five_hour: extract_window("5-hour"),
        seven_day: extract_window("7-day"),
        account_email,
        version_too_old,
    })
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use std::fs;

    #[test]
    fn write_cache_creates_file_with_serialized_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude-rate-limits.json");
        let cache = RateLimits {
            five_hour: Some(LimitWindow { used_percentage: 47, resets_at: "2026-04-30T18:00:00Z".into() }),
            seven_day: Some(LimitWindow { used_percentage: 23, resets_at: "2026-05-04T00:00:00Z".into() }),
            captured_at_ms: 1714478531000,
            account_email: Some("luca@tescari.dev".into()),
            version_too_old: false,
        };
        write_cache(&path, &cache).unwrap();

        let bytes = fs::read(&path).unwrap();
        let parsed: RateLimits = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, cache);
    }

    #[test]
    fn write_cache_creates_parent_directory_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/sub/claude-rate-limits.json");
        let cache = RateLimits {
            five_hour: None,
            seven_day: None,
            captured_at_ms: 0,
            account_email: None,
            version_too_old: true,
        };
        write_cache(&path, &cache).unwrap();
        assert!(path.exists());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INPUT_FRESH: &str = r#"{
      "rate_limits": {
        "5-hour":  { "used_percentage": 47, "resets_at": "2026-04-30T18:00:00Z" },
        "7-day":   { "used_percentage": 23, "resets_at": "2026-05-04T00:00:00Z" }
      },
      "workspace": { "account_email": "luca@tescari.dev" }
    }"#;

    const INPUT_OLD: &str = r#"{
      "workspace": { "account_email": "luca@tescari.dev" }
    }"#;

    #[test]
    fn parse_fresh_input_extracts_both_windows_and_email() {
        let p = parse_input(INPUT_FRESH).unwrap();
        assert_eq!(p.five_hour, Some(LimitWindow { used_percentage: 47, resets_at: "2026-04-30T18:00:00Z".into() }));
        assert_eq!(p.seven_day, Some(LimitWindow { used_percentage: 23, resets_at: "2026-05-04T00:00:00Z".into() }));
        assert_eq!(p.account_email.as_deref(), Some("luca@tescari.dev"));
        assert!(!p.version_too_old);
    }

    #[test]
    fn parse_input_without_rate_limits_marks_version_too_old() {
        let p = parse_input(INPUT_OLD).unwrap();
        assert!(p.five_hour.is_none());
        assert!(p.seven_day.is_none());
        assert!(p.version_too_old);
    }

    #[test]
    fn parse_malformed_json_returns_err() {
        assert!(parse_input("not json").is_err());
    }

    #[test]
    fn parse_input_with_top_level_email_field_is_picked_up() {
        let s = r#"{ "rate_limits": {}, "email": "alt@example.com" }"#;
        let p = parse_input(s).unwrap();
        // top-level email is a fallback when workspace.account_email is absent
        assert_eq!(p.account_email.as_deref(), Some("alt@example.com"));
        // empty rate_limits map ≠ missing key, so we treat windows as None but NOT version_too_old
        assert!(p.five_hour.is_none());
        assert!(p.seven_day.is_none());
        assert!(!p.version_too_old);
    }
}
