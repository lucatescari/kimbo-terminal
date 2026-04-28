//! Best-effort recovery of a running Claude Code session id from a PTY's
//! process descendants. Used by the closed-tab reopen flow so a tab that
//! was killed mid-`claude` surfaces a `claude --resume <uuid>` hint when
//! reopened (Cmd+Shift+T).
//!
//! Detection signature, in priority order:
//!
//!   1. `--resume <uuid>` parsed from a `claude` descendant's command-line
//!      args. Definitive — the user explicitly named the session.
//!   2. Newest-mtime `<uuid>.jsonl` in `~/.claude/projects/<encoded-cwd>/`.
//!      Heuristic — works for the common single-claude-per-cwd case.
//!      Two simultaneous fresh `claude` invocations in the same cwd will
//!      both resolve to whichever wrote most recently; this is documented
//!      as a known limitation in the design spec.
//!
//! The earlier open-fd-based signature (lsof scanning for an open
//! `<uuid>.jsonl` descriptor) was abandoned after live testing showed
//! claude open-writes-closes its session log per message rather than
//! holding the fd, so the probe never caught it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

/// Hard cap on the entire probe (ps + descendant walk + filesystem
/// scan). Tab-close UX cost is bounded by this. The args-and-mtime
/// approach finishes in well under 100 ms on typical hardware; 500 ms
/// is generous headroom for slow disks or a deep process tree.
pub const PROBE_BUDGET: Duration = Duration::from_millis(500);

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

use serde::Deserialize;

/// What we extract from `~/.claude/sessions/<pid>.json`. Mirrors the live
/// metadata file Claude Code writes per running process.
#[derive(Debug, Clone)]
pub struct PidSession {
    pub session_id: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
}

#[derive(Deserialize)]
struct PidSessionRaw {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    #[serde(default, rename = "startedAt")]
    started_at_ms: u64,
}

/// Parse a `~/.claude/sessions/<pid>.json` body. Returns `None` on
/// malformed JSON or when `sessionId` is missing — those are the only
/// hard requirements.
pub(crate) fn parse_pid_json(body: &str) -> Option<PidSession> {
    let raw: PidSessionRaw = serde_json::from_str(body).ok()?;
    let session_id = raw.session_id?;
    Some(PidSession {
        session_id,
        cwd: raw.cwd,
        started_at_ms: raw.started_at_ms,
    })
}

/// Parse one `ps -axo pid=,ppid=,args=` line into `(pid, ppid, args)`.
/// `args` may contain spaces (it's the rest of the line).
fn parse_ps_line(line: &str) -> Option<(u32, u32, &str)> {
    let line = line.trim_start();
    let (pid_s, rest) = line.split_once(|c: char| c.is_whitespace())?;
    let pid: u32 = pid_s.parse().ok()?;
    let rest = rest.trim_start();
    let (ppid_s, rest) = rest.split_once(|c: char| c.is_whitespace())?;
    let ppid: u32 = ppid_s.parse().ok()?;
    Some((pid, ppid, rest.trim_start()))
}

/// From a `ps -axo pid=,ppid=,args=` snapshot, walk all transitive
/// descendants of `root` (excluding `root` itself) and return their
/// `(pid, args)` pairs. Walk order is DFS via a stack — order is not
/// load-bearing because the probe filters by command before iterating.
pub(crate) fn parse_descendants_with_args(ps_output: &str, root: u32) -> Vec<(u32, String)> {
    let mut children_of: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut args_of: HashMap<u32, String> = HashMap::new();
    for line in ps_output.lines() {
        if let Some((pid, ppid, args)) = parse_ps_line(line) {
            children_of.entry(ppid).or_default().push(pid);
            args_of.insert(pid, args.to_string());
        }
    }
    let mut out: Vec<(u32, String)> = Vec::new();
    let mut queue: Vec<u32> = children_of.get(&root).cloned().unwrap_or_default();
    while let Some(pid) = queue.pop() {
        let args = args_of.get(&pid).cloned().unwrap_or_default();
        out.push((pid, args));
        if let Some(kids) = children_of.get(&pid) {
            queue.extend_from_slice(kids);
        }
    }
    out
}

/// True if the first whitespace-separated token of `args` has the
/// basename `claude` exactly. Filters out related-but-different binaries
/// like `claude-cowork` (matched as `npm exec claude-cowork`, where the
/// first token is `npm`) and shell wrappers that don't exec to claude.
pub(crate) fn is_claude_command(args: &str) -> bool {
    let first = args.split_whitespace().next().unwrap_or("");
    let basename = first.rsplit('/').next().unwrap_or("");
    basename == "claude"
}

/// Find a UUID following `--resume` (or `--resume=<uuid>`) anywhere in
/// the args. Returns `None` if no match or the value isn't a UUID.
pub(crate) fn extract_resume_uuid(args: &str) -> Option<String> {
    let mut it = args.split_whitespace();
    while let Some(tok) = it.next() {
        if tok == "--resume" {
            if let Some(next) = it.next() {
                if is_uuid_v4_shape(next) {
                    return Some(next.to_string());
                }
            }
        } else if let Some(rest) = tok.strip_prefix("--resume=") {
            if is_uuid_v4_shape(rest) {
                return Some(rest.to_string());
            }
        }
    }
    None
}

/// Encode a cwd path to claude's project-dir name. Claude Code stores
/// per-project session logs under `~/.claude/projects/<encoded>/` where
/// `<encoded>` is the cwd with every `/` replaced by `-` (so a leading
/// `/` becomes a leading `-`).
pub(crate) fn encode_claude_cwd(cwd: &str) -> String {
    cwd.replace('/', "-")
}

/// Loose UUID shape check (8-4-4-4-12 hex). Accepts both lowercase and
/// uppercase hex; in practice Claude Code only emits lowercase.
fn is_uuid_v4_shape(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let bytes = s.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        let want_dash = matches!(i, 8 | 13 | 18 | 23);
        if want_dash {
            if b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// Scan a directory and return the UUID stem of the most-recently-
/// modified `<uuid>.jsonl` file. Returns `None` on missing/unreadable
/// directory, no matching files, or any per-entry IO error.
fn newest_jsonl_uuid_in_dir(dir: &Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(SystemTime, String)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let stem = match name_str.strip_suffix(".jsonl") {
            Some(s) => s,
            None => continue,
        };
        if !is_uuid_v4_shape(stem) {
            continue;
        }
        let mtime = match entry.metadata().ok().and_then(|m| m.modified().ok()) {
            Some(t) => t,
            None => continue,
        };
        match &best {
            Some((bt, _)) if *bt >= mtime => {}
            _ => best = Some((mtime, stem.to_string())),
        }
    }
    best.map(|(_, uuid)| uuid)
}

// ---------------------------------------------------------------------------
// Probe entry point
// ---------------------------------------------------------------------------

/// Best-effort probe: walk descendants of `root`, look for a `claude`
/// process, return its session UUID via tier-1 (args) or tier-2 (newest
/// JSONL on disk). `cwd` is the kimbo tab's last-known working
/// directory — required for tier-2; tier-1 works without it.
///
/// Returns `None` on missing `ps`, no claude descendants, budget
/// exhaustion, or no recoverable UUID. Never panics.
pub fn probe_claude_session_for_pid(root: u32, cwd: Option<&str>) -> Option<String> {
    let deadline = Instant::now() + PROBE_BUDGET;

    let ps_out = run_with_deadline("ps", &["-axo", "pid=,ppid=,args="], deadline)?;
    let descendants = parse_descendants_with_args(&ps_out, root);
    if descendants.is_empty() {
        return None;
    }

    let claude_procs: Vec<&(u32, String)> = descendants
        .iter()
        .filter(|(_, args)| is_claude_command(args))
        .collect();
    if claude_procs.is_empty() {
        return None;
    }

    // Tier 1: explicit `--resume <uuid>` in args.
    for (_pid, args) in &claude_procs {
        if let Some(uuid) = extract_resume_uuid(args) {
            return Some(uuid);
        }
    }

    // Tier 2: newest `<uuid>.jsonl` in the encoded-cwd projects dir.
    if let Some(cwd) = cwd {
        let encoded = encode_claude_cwd(cwd);
        if let Ok(home) = std::env::var("HOME") {
            let dir = PathBuf::from(home).join(".claude/projects").join(&encoded);
            if let Some(uuid) = newest_jsonl_uuid_in_dir(&dir) {
                return Some(uuid);
            }
        }
    }

    None
}

/// Shell out and capture stdout, abandoning if the deadline is reached.
/// Errors and timeouts both return None — the probe is best-effort.
///
/// A background reader thread drains stdout in parallel with the
/// deadline poll. Without this, large outputs (`ps -axo args=` on a
/// machine with many processes) can fill the pipe buffer, blocking the
/// child on write while `try_wait` keeps reporting "still running" —
/// we'd hit the deadline and kill a process that was actually fine.
fn run_with_deadline(prog: &str, args: &[&str], deadline: Instant) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;

    if Instant::now() >= deadline {
        return None;
    }
    let mut child = Command::new(prog)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Move stdout into a reader thread that buffers everything until
    // EOF. EOF arrives either when the child exits cleanly or when we
    // kill it on deadline (closing the pipe).
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    loop {
        match child.try_wait().ok()? {
            Some(_status) => {
                // Child finished — reader will see EOF and send within
                // a couple ms. Cap the receive so a wedged reader can't
                // hang us past the budget.
                return rx.recv_timeout(Duration::from_millis(50)).ok();
            }
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------
    // parse_descendants_with_args
    // -----------------------------------------------------------------

    #[test]
    fn parse_descendants_with_args_finds_direct_children() {
        let ps = "\
1 0 init
100 1 zsh
200 1 other
101 100 claude --resume aaa
";
        let mut got = parse_descendants_with_args(ps, 100);
        got.sort_by_key(|(pid, _)| *pid);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, 101);
        assert_eq!(got[0].1, "claude --resume aaa");
    }

    #[test]
    fn parse_descendants_with_args_walks_transitively() {
        let ps = "\
1 0 init
500 1 zsh
501 500 claude
502 501 node
503 502 worker --thing
600 1 unrelated
";
        let mut got: Vec<u32> = parse_descendants_with_args(ps, 500)
            .into_iter()
            .map(|(p, _)| p)
            .collect();
        got.sort();
        assert_eq!(got, vec![501, 502, 503]);
    }

    #[test]
    fn parse_descendants_with_args_no_match_returns_empty() {
        let ps = "1 0 init\n2 1 a\n3 2 b\n";
        assert!(parse_descendants_with_args(ps, 9999).is_empty());
    }

    #[test]
    fn parse_descendants_with_args_handles_multispace_alignment() {
        // macOS ps right-aligns numeric columns with leading spaces.
        let ps = "    1     0 init\n  100     1 zsh\n  101   100 claude --resume xyz\n";
        let got = parse_descendants_with_args(ps, 100);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, 101);
        assert_eq!(got[0].1, "claude --resume xyz");
    }

    #[test]
    fn parse_descendants_with_args_skips_garbage_lines() {
        let ps = "\
not a number here
1 0 init
100 1 zsh
junk junk
101 100 claude
";
        let mut got: Vec<u32> = parse_descendants_with_args(ps, 1)
            .into_iter()
            .map(|(p, _)| p)
            .collect();
        got.sort();
        assert_eq!(got, vec![100, 101]);
    }

    // -----------------------------------------------------------------
    // is_claude_command
    // -----------------------------------------------------------------

    #[test]
    fn is_claude_command_accepts_bare_claude() {
        assert!(is_claude_command("claude"));
        assert!(is_claude_command("claude --resume abc"));
    }

    #[test]
    fn is_claude_command_accepts_full_path() {
        assert!(is_claude_command(
            "/opt/homebrew/Caskroom/claude-code@latest/2.1.112/claude"
        ));
        assert!(is_claude_command(
            "/opt/homebrew/Caskroom/claude-code@latest/2.1.112/claude --resume abc"
        ));
    }

    #[test]
    fn is_claude_command_rejects_node_or_npm_wrappers() {
        assert!(!is_claude_command("node /Users/u/.../claude-cowork"));
        assert!(!is_claude_command("npm exec claude-cowork"));
        assert!(!is_claude_command("zsh"));
        assert!(!is_claude_command(""));
    }

    #[test]
    fn is_claude_command_rejects_similar_names() {
        // We want exactly `claude`, not `claude-cowork`, `claude-code`, etc.
        assert!(!is_claude_command("claude-cowork"));
        assert!(!is_claude_command("/usr/local/bin/claude-cowork"));
    }

    // -----------------------------------------------------------------
    // extract_resume_uuid
    // -----------------------------------------------------------------

    #[test]
    fn extract_resume_uuid_handles_separated_form() {
        assert_eq!(
            extract_resume_uuid("claude --resume 5a7f9805-2543-4dd9-94ce-9563047d2c26")
                .as_deref(),
            Some("5a7f9805-2543-4dd9-94ce-9563047d2c26")
        );
    }

    #[test]
    fn extract_resume_uuid_handles_equals_form() {
        assert_eq!(
            extract_resume_uuid("claude --resume=5a7f9805-2543-4dd9-94ce-9563047d2c26")
                .as_deref(),
            Some("5a7f9805-2543-4dd9-94ce-9563047d2c26")
        );
    }

    #[test]
    fn extract_resume_uuid_returns_none_when_missing() {
        assert!(extract_resume_uuid("claude").is_none());
        assert!(extract_resume_uuid("claude --some-other-flag").is_none());
    }

    #[test]
    fn extract_resume_uuid_returns_none_when_value_not_uuid() {
        assert!(extract_resume_uuid("claude --resume notauuid").is_none());
        assert!(extract_resume_uuid("claude --resume=notauuid").is_none());
    }

    #[test]
    fn extract_resume_uuid_ignores_arg_after_flag_consumed() {
        // After consuming the value, --resume must not match a later token.
        assert_eq!(
            extract_resume_uuid(
                "claude --resume aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa --other bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
            )
            .as_deref(),
            Some("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        );
    }

    // -----------------------------------------------------------------
    // encode_claude_cwd
    // -----------------------------------------------------------------

    #[test]
    fn encode_claude_cwd_replaces_slashes_with_dashes() {
        assert_eq!(
            encode_claude_cwd("/Users/luca/Projects/Private/kimbo-terminal"),
            "-Users-luca-Projects-Private-kimbo-terminal"
        );
    }

    #[test]
    fn encode_claude_cwd_handles_root_and_empty() {
        assert_eq!(encode_claude_cwd("/"), "-");
        assert_eq!(encode_claude_cwd(""), "");
    }

    // -----------------------------------------------------------------
    // newest_jsonl_uuid_in_dir
    // -----------------------------------------------------------------

    fn unique_temp_subdir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "kimbo-claude-probe-{}-{}-{}",
            tag,
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn newest_jsonl_uuid_in_dir_returns_none_for_missing_dir() {
        let dir = std::env::temp_dir().join("kimbo-claude-probe-does-not-exist-xyz");
        assert!(newest_jsonl_uuid_in_dir(&dir).is_none());
    }

    #[test]
    fn newest_jsonl_uuid_in_dir_returns_none_when_empty() {
        let dir = unique_temp_subdir("empty");
        assert!(newest_jsonl_uuid_in_dir(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn newest_jsonl_uuid_in_dir_skips_non_jsonl_and_invalid_basenames() {
        let dir = unique_temp_subdir("filtered");
        std::fs::write(dir.join("config.json"), "{}").unwrap();
        std::fs::write(dir.join("not-a-uuid.jsonl"), "{}").unwrap();
        std::fs::write(dir.join("README.md"), "x").unwrap();
        assert!(newest_jsonl_uuid_in_dir(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn newest_jsonl_uuid_in_dir_picks_latest_by_mtime() {
        let dir = unique_temp_subdir("mtime");
        let old_uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        std::fs::write(dir.join(format!("{}.jsonl", old_uuid)), "old").unwrap();
        // Sleep long enough to guarantee a distinct mtime on macOS HFS+/APFS.
        std::thread::sleep(Duration::from_millis(20));
        let new_uuid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        std::fs::write(dir.join(format!("{}.jsonl", new_uuid)), "new").unwrap();
        let got = newest_jsonl_uuid_in_dir(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(got.as_deref(), Some(new_uuid));
    }

    // -----------------------------------------------------------------
    // is_uuid_v4_shape
    // -----------------------------------------------------------------

    #[test]
    fn is_uuid_v4_shape_accepts_canonical_form() {
        assert!(is_uuid_v4_shape("d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d"));
    }

    #[test]
    fn is_uuid_v4_shape_rejects_wrong_length_or_dashes() {
        assert!(!is_uuid_v4_shape("d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2"));
        assert!(!is_uuid_v4_shape("d2c1d5a4_7f3a_4b8b_9bb3_1e5c6f9a3b2d"));
        assert!(!is_uuid_v4_shape("zzzzzzzz-7f3a-4b8b-9bb3-1e5c6f9a3b2d"));
    }

    // -----------------------------------------------------------------
    // parse_pid_json
    // -----------------------------------------------------------------

    #[test]
    fn parse_pid_json_extracts_session_id_cwd_started_at() {
        let body = r#"{
            "pid": 3929,
            "sessionId": "5a7f9805-2543-4dd9-94ce-9563047d2c26",
            "cwd": "/Users/luca/proj",
            "startedAt": 1777368328688,
            "kind": "interactive",
            "entrypoint": "cli"
        }"#;
        let got = parse_pid_json(body).expect("happy-path parse");
        assert_eq!(got.session_id, "5a7f9805-2543-4dd9-94ce-9563047d2c26");
        assert_eq!(got.cwd.as_deref(), Some("/Users/luca/proj"));
        assert_eq!(got.started_at_ms, 1777368328688);
    }

    #[test]
    fn parse_pid_json_returns_none_for_malformed() {
        assert!(parse_pid_json("{ not json").is_none());
        assert!(parse_pid_json("").is_none());
    }

    #[test]
    fn parse_pid_json_returns_none_when_session_id_missing() {
        let body = r#"{ "pid": 1, "startedAt": 0 }"#;
        assert!(parse_pid_json(body).is_none());
    }

    #[test]
    fn parse_pid_json_tolerates_missing_optional_fields() {
        // cwd absent — still returns Some with cwd: None.
        let body = r#"{ "sessionId": "abc-123", "startedAt": 42 }"#;
        let got = parse_pid_json(body).expect("session_id is the only required field");
        assert_eq!(got.session_id, "abc-123");
        assert!(got.cwd.is_none());
        assert_eq!(got.started_at_ms, 42);
    }
}
