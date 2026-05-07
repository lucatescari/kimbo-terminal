use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LimitWindow {
    pub used_percentage: u8,
    /// Unix timestamp in seconds (Claude Code's native shape).
    pub resets_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ParsedInput {
    pub five_hour: Option<LimitWindow>,
    pub seven_day: Option<LimitWindow>,
    pub version_too_old: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RateLimits {
    pub five_hour: Option<LimitWindow>,
    pub seven_day: Option<LimitWindow>,
    pub captured_at_ms: u64,
    pub version_too_old: bool,
}

/// Write the cache file atomically (write to a uniquely-named .tmp sibling,
/// then rename). Concurrent invocations get distinct tmp names so they don't
/// stomp each other's bytes. Tmp file is removed on any failure.
pub fn write_cache(path: &Path, cache: &RateLimits) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(cache)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("{}.{}.tmp", std::process::id(), nanos));
    if let Err(e) = std::fs::write(&tmp, &bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// Parse the JSON Claude Code pipes into the statusLine command.
/// Returns `Err` only on malformed JSON. Missing optional fields are tolerated.
///
/// Real Claude Code 2.1.112 sends:
/// ```json
/// {
///   "rate_limits": {
///     "five_hour": { "used_percentage": 22, "resets_at": 1777902000 },
///     "seven_day": { "used_percentage": 2,  "resets_at": 1778234400 }
///   }
/// }
/// ```
/// `resets_at` is a Unix timestamp in seconds (an integer, not a string).
/// The JSON does not contain the user's email, so we don't capture one.
pub fn parse_input(stdin: &str) -> Result<ParsedInput, serde_json::Error> {
    let v: serde_json::Value = serde_json::from_str(stdin)?;

    let rate_limits = v.get("rate_limits");
    let version_too_old = rate_limits.is_none();

    let extract_window = |key: &str| -> Option<LimitWindow> {
        let w = rate_limits?.get(key)?;
        Some(LimitWindow {
            used_percentage: w.get("used_percentage")?.as_u64()?.min(255) as u8,
            resets_at: w.get("resets_at")?.as_u64()?,
        })
    };

    Ok(ParsedInput {
        five_hour: extract_window("five_hour"),
        seven_day: extract_window("seven_day"),
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
            five_hour: Some(LimitWindow { used_percentage: 47, resets_at: 1777902000 }),
            seven_day: Some(LimitWindow { used_percentage: 23, resets_at: 1778234400 }),
            captured_at_ms: 1714478531000,
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
        "five_hour":  { "used_percentage": 22, "resets_at": 1777902000 },
        "seven_day":  { "used_percentage": 2,  "resets_at": 1778234400 }
      }
    }"#;

    const INPUT_OLD: &str = r#"{
      "model": { "id": "claude-opus-4-7" }
    }"#;

    #[test]
    fn parse_fresh_input_extracts_both_windows() {
        let p = parse_input(INPUT_FRESH).unwrap();
        assert_eq!(p.five_hour, Some(LimitWindow { used_percentage: 22, resets_at: 1777902000 }));
        assert_eq!(p.seven_day, Some(LimitWindow { used_percentage: 2, resets_at: 1778234400 }));
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
    fn parse_input_with_empty_rate_limits_is_not_version_too_old() {
        let s = r#"{ "rate_limits": {} }"#;
        let p = parse_input(s).unwrap();
        // empty rate_limits map ≠ missing key, so we treat windows as None but NOT version_too_old
        assert!(p.five_hour.is_none());
        assert!(p.seven_day.is_none());
        assert!(!p.version_too_old);
    }
}

/// Render the one-line status string Claude Code displays in its TUI.
pub fn render_statusline(parsed: &ParsedInput) -> String {
    let pct = |w: &Option<LimitWindow>| -> String {
        w.as_ref().map_or_else(|| "—%".to_string(), |w| format!("{}%", w.used_percentage))
    };
    format!("5h {} · Wk {}", pct(&parsed.five_hour), pct(&parsed.seven_day))
}

#[cfg(test)]
mod statusline_tests {
    use super::*;

    fn p(used_5h: u8, used_7d: u8) -> ParsedInput {
        ParsedInput {
            five_hour: Some(LimitWindow { used_percentage: used_5h, resets_at: 0 }),
            seven_day: Some(LimitWindow { used_percentage: used_7d, resets_at: 0 }),
            version_too_old: false,
        }
    }

    #[test]
    fn renders_both_windows_with_separator() {
        assert_eq!(render_statusline(&p(47, 23)), "5h 47% · Wk 23%");
    }

    #[test]
    fn renders_dash_for_missing_windows() {
        let parsed = ParsedInput { five_hour: None, seven_day: None, ..Default::default() };
        assert_eq!(render_statusline(&parsed), "5h —% · Wk —%");
    }

    #[test]
    fn renders_dash_only_for_the_missing_window() {
        let parsed = ParsedInput {
            five_hour: Some(LimitWindow { used_percentage: 47, resets_at: 0 }),
            seven_day: None,
            ..Default::default()
        };
        assert_eq!(render_statusline(&parsed), "5h 47% · Wk —%");
    }
}
