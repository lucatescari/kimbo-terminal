use std::io::Write;
use std::process::{Command, Stdio};

const FRESH_JSON: &str = r#"{"rate_limits":{"five_hour":{"used_percentage":47,"resets_at":1777902000},"seven_day":{"used_percentage":23,"resets_at":1778234400}}}"#;

#[test]
fn end_to_end_writes_cache_and_prints_status() {
    let dir = tempfile::tempdir().unwrap();
    let cache_path = dir.path().join("claude-rate-limits.json");

    let bin = env!("CARGO_BIN_EXE_kimbo-claude-statusline");

    let mut child = Command::new(bin)
        .env("KIMBO_APP_DATA", dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    child.stdin.as_mut().unwrap().write_all(FRESH_JSON.as_bytes()).unwrap();
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();

    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "5h 47% · Wk 23%");
    assert!(cache_path.exists(), "expected cache at {cache_path:?}");

    let cache_bytes = std::fs::read(&cache_path).unwrap();
    let cache_str = String::from_utf8_lossy(&cache_bytes);
    assert!(cache_str.contains("\"used_percentage\": 47"));
    assert!(cache_str.contains("\"resets_at\": 1777902000"));
}

#[test]
fn malformed_input_exits_non_zero_and_writes_no_cache() {
    let dir = tempfile::tempdir().unwrap();
    let cache_path = dir.path().join("claude-rate-limits.json");
    let bin = env!("CARGO_BIN_EXE_kimbo-claude-statusline");

    let mut child = Command::new(bin)
        .env("KIMBO_APP_DATA", dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(b"not json").unwrap();
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();

    assert_eq!(
        out.status.code(),
        Some(3),
        "expected exit code 3 for malformed JSON, got {:?}",
        out.status.code()
    );
    assert!(!cache_path.exists(), "cache must not be written on parse failure");
}
