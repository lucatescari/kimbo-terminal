use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use kimbo_claude_statusline::{
    default_claude_json_path, parse_input, read_account_email_from, render_statusline,
    write_cache, RateLimits,
};

fn main() -> ExitCode {
    let mut buf = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut buf) {
        eprintln!("kimbo-claude-statusline: stdin read failed: {e}");
        return ExitCode::from(2);
    }

    let parsed = match parse_input(&buf) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("kimbo-claude-statusline: invalid JSON: {e}");
            return ExitCode::from(3);
        }
    };

    let now_secs = resolve_now_secs();
    let line = render_statusline(&parsed, now_secs);

    // The statusLine JSON doesn't carry the account email, but we run on the
    // user's machine — read it straight from ~/.claude.json so the cache is
    // stamped with the account these numbers belong to. `KIMBO_CLAUDE_JSON`
    // overrides the path so integration tests can pin a fixture.
    let account_email = resolve_claude_json_path().and_then(|p| read_account_email_from(&p));

    let cache = RateLimits {
        five_hour: parsed.five_hour,
        seven_day: parsed.seven_day,
        captured_at_ms: now_ms(),
        version_too_old: parsed.version_too_old,
        account_email,
    };

    let cache_path = resolve_cache_path();
    if let Err(e) = write_cache(&cache_path, &cache) {
        eprintln!("kimbo-claude-statusline: cache write failed: {e}");
        return ExitCode::from(4);
    }

    let _ = writeln!(std::io::stdout(), "{line}");
    ExitCode::SUCCESS
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Resolve the current Unix-seconds clock. Honors the `KIMBO_NOW_SECS`
/// environment variable so integration tests can pin time without mocking
/// `SystemTime`.
fn resolve_now_secs() -> u64 {
    if let Some(override_secs) = std::env::var("KIMBO_NOW_SECS").ok().and_then(|s| s.parse().ok()) {
        return override_secs;
    }
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Resolve the Claude config path, honoring `KIMBO_CLAUDE_JSON` (set by tests)
/// and falling back to `$HOME/.claude.json`.
fn resolve_claude_json_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("KIMBO_CLAUDE_JSON") {
        return Some(PathBuf::from(p));
    }
    default_claude_json_path()
}

fn resolve_cache_path() -> PathBuf {
    let base = std::env::var_os("KIMBO_APP_DATA")
        .map(PathBuf::from)
        .or_else(|| dirs::config_dir().map(|p| p.join("kimbo")))
        .unwrap_or_else(|| PathBuf::from("/tmp/kimbo"));
    base.join("claude-rate-limits.json")
}
