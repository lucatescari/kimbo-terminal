use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use kimbo_claude_statusline::{
    parse_input, render_statusline, write_cache, RateLimits,
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

    let line = render_statusline(&parsed);

    let cache = RateLimits {
        five_hour: parsed.five_hour,
        seven_day: parsed.seven_day,
        captured_at_ms: now_ms(),
        account_email: parsed.account_email,
        version_too_old: parsed.version_too_old,
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

fn resolve_cache_path() -> PathBuf {
    let base = std::env::var_os("KIMBO_APP_DATA")
        .map(PathBuf::from)
        .or_else(|| dirs::config_dir().map(|p| p.join("kimbo")))
        .unwrap_or_else(|| PathBuf::from("/tmp/kimbo"));
    base.join("claude-rate-limits.json")
}
