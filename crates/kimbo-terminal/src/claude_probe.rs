//! Best-effort recovery of a running Claude Code session id from a PTY's
//! process descendants. Used by the closed-tab reopen flow so a tab that
//! was killed mid-`claude` surfaces a `claude --resume <uuid>` hint when
//! reopened (Cmd+Shift+T).
//!
//! The detection signature is "process holds an open fd under
//! ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl" — not a process-name
//! match — so wrappers like `npx claude` are caught too.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Hard cap on the entire probe (descendant collection + lsof per pid).
/// Tab-close UX cost: roughly this much added latency. 100ms is below the
/// human-perceptible-as-laggy threshold and well above what `ps` + a small
/// number of `lsof` calls actually take in practice.
pub const PROBE_BUDGET: Duration = Duration::from_millis(100);

/// Parse `ps -axo pid=,ppid=` output and return the transitive descendants
/// of `root` (excluding root itself), in DFS order (deepest-first via a
/// stack). Order is not load-bearing — `probe_claude_session_for_pid`
/// uses first-match semantics and any traversal would yield the same
/// answer when a single descendant holds the JSONL fd. Lines that don't
/// parse as two integers are skipped.
pub(crate) fn parse_descendants(ps_output: &str, root: u32) -> Vec<u32> {
    let mut children_of: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in ps_output.lines() {
        let mut it = line.split_whitespace();
        let pid: Option<u32> = it.next().and_then(|s| s.parse().ok());
        let ppid: Option<u32> = it.next().and_then(|s| s.parse().ok());
        if let (Some(pid), Some(ppid)) = (pid, ppid) {
            children_of.entry(ppid).or_default().push(pid);
        }
    }

    let mut out: Vec<u32> = Vec::new();
    let mut queue: Vec<u32> = children_of.get(&root).cloned().unwrap_or_default();
    while let Some(pid) = queue.pop() {
        out.push(pid);
        if let Some(kids) = children_of.get(&pid) {
            queue.extend_from_slice(kids);
        }
    }
    out
}

/// Parse `lsof -p <pid> -Fn` output and extract the first `~/.claude/projects/.../<uuid>.jsonl`
/// session-log path's UUID. Each `n`-prefixed line is one filename; we look
/// for one ending in `/<36-char-uuid>.jsonl` somewhere under `.claude/projects/`.
/// Returns `None` if no match.
pub(crate) fn parse_claude_jsonl_fd(lsof_output: &str) -> Option<String> {
    for line in lsof_output.lines() {
        // Lines we care about start with 'n' (name field). Strip the prefix.
        let path = match line.strip_prefix('n') {
            Some(p) => p,
            None => continue,
        };
        if !path.contains("/.claude/projects/") {
            continue;
        }
        let basename = path.rsplit('/').next().unwrap_or("");
        let stem = match basename.strip_suffix(".jsonl") {
            Some(s) => s,
            None => continue,
        };
        if is_uuid_v4_shape(stem) {
            return Some(stem.to_string());
        }
    }
    None
}

/// Loose UUID shape check (8-4-4-4-12 hex). Avoids pulling a UUID crate
/// just for one validation.
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

/// Best-effort probe: shell `ps -axo pid=,ppid=` once, then `lsof -p <pid> -Fn`
/// per descendant. First match wins. Returns `None` on missing tools, no
/// match, or budget exhaustion. Never panics.
pub fn probe_claude_session_for_pid(root: u32) -> Option<String> {
    let deadline = Instant::now() + PROBE_BUDGET;
    let ps_out = run_with_deadline("ps", &["-axo", "pid=,ppid="], deadline)?;
    let descendants = parse_descendants(&ps_out, root);
    if descendants.is_empty() {
        return None;
    }
    for pid in descendants {
        if Instant::now() >= deadline {
            return None;
        }
        let pid_str = pid.to_string();
        let lsof_out = match run_with_deadline("lsof", &["-p", &pid_str, "-Fn"], deadline) {
            Some(s) => s,
            None => continue,
        };
        if let Some(uuid) = parse_claude_jsonl_fd(&lsof_out) {
            return Some(uuid);
        }
    }
    None
}

/// Shell out and capture stdout, abandoning if the deadline is reached.
/// Errors and timeouts both return None — the probe is best-effort.
fn run_with_deadline(prog: &str, args: &[&str], deadline: Instant) -> Option<String> {
    use std::process::{Command, Stdio};

    if Instant::now() >= deadline {
        return None;
    }
    let mut child = Command::new(prog)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Polling wait: avoids pulling a dependency for a one-shot timeout.
    loop {
        match child.try_wait().ok()? {
            Some(_status) => break,
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }
    let mut buf = String::new();
    use std::io::Read;
    child.stdout.as_mut()?.read_to_string(&mut buf).ok()?;
    Some(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_descendants_finds_direct_children() {
        let ps = "\
1 0
100 1
200 1
101 100
201 200
";
        let mut got = parse_descendants(ps, 100);
        got.sort();
        assert_eq!(got, vec![101]);
    }

    #[test]
    fn parse_descendants_walks_transitively() {
        let ps = "\
1 0
500 1
501 500
502 501
503 502
600 1
";
        let mut got = parse_descendants(ps, 500);
        got.sort();
        assert_eq!(got, vec![501, 502, 503]);
    }

    #[test]
    fn parse_descendants_no_match_returns_empty() {
        let ps = "1 0\n2 1\n3 2\n";
        assert!(parse_descendants(ps, 9999).is_empty());
    }

    #[test]
    fn parse_descendants_skips_garbage_lines() {
        let ps = "\
not a number here
1 0
100 1
junk junk
101 100
";
        let mut got = parse_descendants(ps, 1);
        got.sort();
        assert_eq!(got, vec![100, 101]);
    }

    #[test]
    fn parse_claude_jsonl_fd_finds_match() {
        let lsof = "\
p12345
ftxt
n/Users/luca/Library/Caches/foo
ftxt
n/Users/luca/.claude/projects/-Users-luca-proj/d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d.jsonl
ftxt
n/dev/ttys001
";
        assert_eq!(
            parse_claude_jsonl_fd(lsof).as_deref(),
            Some("d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d"),
        );
    }

    #[test]
    fn parse_claude_jsonl_fd_returns_none_when_no_jsonl() {
        let lsof = "\
p12345
n/Users/luca/.claude/settings.json
n/dev/ttys001
n/private/tmp/foo
";
        assert!(parse_claude_jsonl_fd(lsof).is_none());
    }

    #[test]
    fn parse_claude_jsonl_fd_ignores_jsonl_outside_projects_dir() {
        let lsof = "\
n/Users/luca/somewhere-else/d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d.jsonl
";
        assert!(parse_claude_jsonl_fd(lsof).is_none());
    }

    #[test]
    fn parse_claude_jsonl_fd_ignores_non_uuid_basename() {
        let lsof = "\
n/Users/luca/.claude/projects/-foo/not-a-uuid.jsonl
";
        assert!(parse_claude_jsonl_fd(lsof).is_none());
    }

    #[test]
    fn parse_claude_jsonl_fd_first_match_wins() {
        let lsof = "\
n/Users/luca/.claude/projects/-a/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl
n/Users/luca/.claude/projects/-b/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl
";
        assert_eq!(
            parse_claude_jsonl_fd(lsof).as_deref(),
            Some("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        );
    }

    #[test]
    fn is_uuid_v4_shape_accepts_canonical_form() {
        assert!(is_uuid_v4_shape("d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d"));
    }

    #[test]
    fn is_uuid_v4_shape_rejects_wrong_length_or_dashes() {
        assert!(!is_uuid_v4_shape("d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2"));    // too short
        assert!(!is_uuid_v4_shape("d2c1d5a4_7f3a_4b8b_9bb3_1e5c6f9a3b2d"));   // wrong sep
        assert!(!is_uuid_v4_shape("zzzzzzzz-7f3a-4b8b-9bb3-1e5c6f9a3b2d"));   // non-hex
    }
}
