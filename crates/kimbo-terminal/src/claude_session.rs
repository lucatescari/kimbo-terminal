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
    /// Claude Code's own live status for this session. Verbatim, not
    /// interpreted here: `"busy"`, `"idle"`, `"waiting"`, and `"shell"` are
    /// all observed, and the set is Claude Code's to grow. `busy` is
    /// `isLoading || delegatedActive`, so it already covers a turn parked in
    /// a Task call while subagents work.
    pub status: Option<String>,
    /// Why the session is waiting, when `status == "waiting"`. Human-readable
    /// and shown in a tooltip: "input needed", "worker request",
    /// "sandbox request", "dialog open", or a dialog's own label.
    pub waiting_for: Option<String>,
    pub status_updated_at_ms: Option<u64>,
}

#[derive(Deserialize)]
struct PidSessionRaw {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    #[serde(default, rename = "startedAt")]
    started_at_ms: u64,
    status: Option<String>,
    #[serde(rename = "waitingFor")]
    waiting_for: Option<String>,
    #[serde(rename = "statusUpdatedAt")]
    status_updated_at_ms: Option<u64>,
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
        status: raw.status,
        waiting_for: raw.waiting_for,
        status_updated_at_ms: raw.status_updated_at_ms,
    })
}

/// One background Claude Code session, from `~/.claude/jobs/<short>/state.json`.
///
/// These are the sessions `/fork` creates. They outlive the turn that spawned
/// them, which is why a pane can look idle while work is still running: the
/// `Stop` hook fires for the interactive session and says nothing about these.
#[derive(Debug, Clone, PartialEq)]
pub struct JobState {
    pub session_id: String,
    /// The interactive session that forked this job. Required: without it
    /// there is nothing to attribute the job to, and matching by cwd instead
    /// is wrong whenever two panes share a directory.
    pub fork_parent_session_id: String,
    /// `"active"`, `"blocked"`, or `"idle"`. The reliable tri-state; the
    /// sibling `state` field is an open vocabulary (`blocked`, `failed`,
    /// `running`, ...) and is deliberately not read.
    pub tempo: Option<String>,
    pub in_flight_tasks: u32,
    /// ISO 8601, verbatim. Kept as a string because this crate has no date
    /// dependency and `Date.parse` handles it for free on the JS side.
    pub updated_at: Option<String>,
    pub detail: Option<String>,
}

#[derive(Deserialize)]
struct JobStateRaw {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "forkParentSessionId")]
    fork_parent_session_id: Option<String>,
    tempo: Option<String>,
    #[serde(rename = "inFlight")]
    in_flight: Option<InFlightRaw>,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
    detail: Option<String>,
}

#[derive(Deserialize)]
struct InFlightRaw {
    #[serde(default)]
    tasks: u32,
}

/// Parse a `~/.claude/jobs/<short>/state.json` body. Returns `None` on
/// malformed JSON, a missing `sessionId`, or a missing
/// `forkParentSessionId` — the last of which is a deliberate drop, not an
/// error.
pub(crate) fn parse_job_state(body: &str) -> Option<JobState> {
    let raw: JobStateRaw = serde_json::from_str(body).ok()?;
    Some(JobState {
        session_id: raw.session_id?,
        fork_parent_session_id: raw.fork_parent_session_id?,
        tempo: raw.tempo,
        in_flight_tasks: raw.in_flight.map(|f| f.tasks).unwrap_or(0),
        updated_at: raw.updated_at,
        detail: raw.detail,
    })
}

/// Live-running totals of a Claude Code session, derived from its
/// `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` log.
#[derive(Debug, Default, Clone)]
pub struct JsonlStats {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub message_count: u32,
    pub tool_count: u32,
}

/// Walk a JSONL body line-by-line and accumulate the stats. Skips lines
/// that don't parse as JSON or don't have the shape we care about.
/// `model` and `permission_mode` are last-write-wins (latest occurrence
/// in the file); other fields sum.
pub(crate) fn accumulate_jsonl_stats(body: &str) -> JsonlStats {
    let mut stats = JsonlStats::default();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let entry_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        if entry_type == "permission-mode" {
            if let Some(m) = v.get("permissionMode").and_then(|m| m.as_str()) {
                stats.permission_mode = Some(m.to_string());
            }
            continue;
        }

        if entry_type == "user" || entry_type == "assistant" {
            stats.message_count += 1;
        }

        // Token usage and model are nested under `message` for both
        // wrapping conventions Claude Code uses.
        if let Some(msg) = v.get("message") {
            if let Some(usage) = msg.get("usage") {
                if let Some(n) = usage.get("input_tokens").and_then(|n| n.as_u64()) {
                    stats.input_tokens += n;
                }
                if let Some(n) = usage.get("output_tokens").and_then(|n| n.as_u64()) {
                    stats.output_tokens += n;
                }
            }
            if let Some(model) = msg.get("model").and_then(|m| m.as_str()) {
                stats.model = Some(model.to_string());
            }
            if entry_type == "assistant" {
                if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            stats.tool_count += 1;
                        }
                    }
                }
            }
        }
    }
    stats
}

/// What the JS HUD renders. JSON-serializable so the Tauri command
/// can return this directly to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClaudeStatus {
    pub session_id: String,
    pub model: Option<String>,
    pub started_at_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub permission_mode: Option<String>,
    pub message_count: u32,
    pub tool_count: u32,
}

/// Inner helper: given a specific pid, attempt to read a live claude
/// session for that pid. Returns `None` when there is no
/// `~/.claude/sessions/<pid>.json` for that pid.
pub(crate) fn read_status_for_pid(pid: u32) -> Option<ClaudeStatus> {
    let home = std::env::var("HOME").ok()?;
    let sessions_path = std::path::PathBuf::from(&home)
        .join(".claude/sessions")
        .join(format!("{}.json", pid));
    let body = std::fs::read_to_string(&sessions_path).ok()?;
    let pid_session = parse_pid_json(&body)?;

    let stats = pid_session
        .cwd
        .as_deref()
        .map(|cwd| {
            let encoded = encode_claude_cwd(cwd);
            let jsonl_path = std::path::PathBuf::from(&home)
                .join(".claude/projects")
                .join(&encoded)
                .join(format!("{}.jsonl", pid_session.session_id));
            std::fs::read_to_string(&jsonl_path)
                .map(|body| accumulate_jsonl_stats(&body))
                .unwrap_or_default()
        })
        .unwrap_or_default();

    Some(ClaudeStatus {
        session_id: pid_session.session_id,
        model: stats.model,
        started_at_ms: pid_session.started_at_ms,
        input_tokens: stats.input_tokens,
        output_tokens: stats.output_tokens,
        permission_mode: stats.permission_mode,
        message_count: stats.message_count,
        tool_count: stats.tool_count,
    })
}

/// Public probe: walk descendants of `root` and return the first
/// descendant that has a `~/.claude/sessions/<pid>.json` we can read.
/// Returns `None` if no descendant matches, the budget is exhausted,
/// or filesystem access fails.
pub fn probe_claude_status_for_pid(root: u32) -> Option<ClaudeStatus> {
    let deadline = Instant::now() + PROBE_BUDGET;
    let ps_out = run_with_deadline("ps", &["-axo", "pid=,ppid=,args="], deadline)?;
    let descendants = parse_descendants_with_args(&ps_out, root);
    for (pid, _args) in descendants {
        if let Some(status) = read_status_for_pid(pid) {
            return Some(status);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Tab activity states
// ---------------------------------------------------------------------------

/// A background job as the frontend sees it. `JobState` minus the parent id,
/// which has already been consumed to decide which PTY the job belongs to.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackgroundJobState {
    pub session_id: String,
    pub tempo: Option<String>,
    pub in_flight_tasks: u32,
    pub updated_at: Option<String>,
    pub detail: Option<String>,
}

/// Raw Claude Code state for one PTY. Deliberately uninterpreted: every
/// decision about what counts as busy lives in `src-ui/claude-activity.ts`,
/// where it is a pure function with tests.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PtyClaudeState {
    pub pty_id: u32,
    pub session_id: String,
    pub status: Option<String>,
    pub waiting_for: Option<String>,
    pub status_updated_at_ms: Option<u64>,
    pub background: Vec<BackgroundJobState>,
}

/// Attach each background job to the PTY whose session forked it. Pure, so
/// the attribution rules are testable without a process table.
///
/// A job with no matching parent among `sessions` is dropped rather than
/// attributed by cwd: two panes in the same directory would both claim it.
pub(crate) fn attach_background(
    sessions: Vec<(u32, PidSession)>,
    jobs: &[JobState],
) -> Vec<PtyClaudeState> {
    sessions
        .into_iter()
        .map(|(pty_id, session)| {
            let background = jobs
                .iter()
                .filter(|j| j.fork_parent_session_id == session.session_id)
                .map(|j| BackgroundJobState {
                    session_id: j.session_id.clone(),
                    tempo: j.tempo.clone(),
                    in_flight_tasks: j.in_flight_tasks,
                    updated_at: j.updated_at.clone(),
                    detail: j.detail.clone(),
                })
                .collect();
            PtyClaudeState {
                pty_id,
                session_id: session.session_id,
                status: session.status,
                waiting_for: session.waiting_for,
                status_updated_at_ms: session.status_updated_at_ms,
                background,
            }
        })
        .collect()
}

/// Read every background job on disk. Missing directory yields an empty vec;
/// an unreadable or malformed file is skipped rather than failing the batch.
fn read_all_jobs(home: &str) -> Vec<JobState> {
    let dir = PathBuf::from(home).join(".claude").join("jobs");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path().join("state.json");
        if let Ok(body) = std::fs::read_to_string(&path) {
            if let Some(job) = parse_job_state(&body) {
                out.push(job);
            }
        }
    }
    out
}

/// Live Claude Code state for a batch of PTYs.
///
/// `pty_pids` is `(pty_id, root_pid)` pairs. One `ps` snapshot serves the
/// whole batch, which is the point: the per-pane probes this replaces each
/// shelled out to `ps` separately, so covering every pane in every tab now
/// costs less process-table work than covering only the visible ones did.
///
/// A PTY with no Claude session is omitted from the result rather than
/// returned as an empty entry.
pub fn probe_claude_tab_states(pty_pids: &[(u32, u32)]) -> Vec<PtyClaudeState> {
    if pty_pids.is_empty() {
        return Vec::new();
    }
    let Ok(home) = std::env::var("HOME") else {
        return Vec::new();
    };
    let deadline = Instant::now() + PROBE_BUDGET;
    let Some(ps_out) = run_with_deadline("ps", &["-axo", "pid=,ppid=,args="], deadline) else {
        return Vec::new();
    };

    let jobs = read_all_jobs(&home);
    let sessions_dir = PathBuf::from(&home).join(".claude").join("sessions");

    let mut sessions: Vec<(u32, PidSession)> = Vec::new();
    for &(pty_id, root_pid) in pty_pids {
        for (pid, _args) in parse_descendants_with_args(&ps_out, root_pid) {
            let path = sessions_dir.join(format!("{}.json", pid));
            let Ok(body) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Some(session) = parse_pid_json(&body) {
                sessions.push((pty_id, session));
                break; // first claude descendant wins, as elsewhere in this file
            }
        }
    }

    attach_background(sessions, &jobs)
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
            extract_resume_uuid("claude --resume 5a7f9805-2543-4dd9-94ce-9563047d2c26").as_deref(),
            Some("5a7f9805-2543-4dd9-94ce-9563047d2c26")
        );
    }

    #[test]
    fn extract_resume_uuid_handles_equals_form() {
        assert_eq!(
            extract_resume_uuid("claude --resume=5a7f9805-2543-4dd9-94ce-9563047d2c26").as_deref(),
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

    #[test]
    fn parse_pid_json_reads_status_fields() {
        // Shape taken verbatim from a live ~/.claude/sessions/<pid>.json.
        let body = r#"{
            "pid": 7496,
            "sessionId": "1af5d332-cf0e-49ea-b7ee-9e1027a6c88d",
            "cwd": "/Users/u/proj",
            "startedAt": 1788192356257,
            "kind": "interactive",
            "status": "busy",
            "updatedAt": 1788192511101,
            "statusUpdatedAt": 1788192511101
        }"#;
        let got = parse_pid_json(body).expect("happy path");
        assert_eq!(got.session_id, "1af5d332-cf0e-49ea-b7ee-9e1027a6c88d");
        assert_eq!(got.status.as_deref(), Some("busy"));
        assert_eq!(got.status_updated_at_ms, Some(1788192511101));
        assert_eq!(got.waiting_for, None);
    }

    #[test]
    fn parse_pid_json_reads_waiting_for() {
        let body = r#"{
            "sessionId": "abc",
            "status": "waiting",
            "waitingFor": "input needed"
        }"#;
        let got = parse_pid_json(body).expect("happy path");
        assert_eq!(got.status.as_deref(), Some("waiting"));
        assert_eq!(got.waiting_for.as_deref(), Some("input needed"));
    }

    #[test]
    fn parse_pid_json_tolerates_a_file_with_no_status_fields() {
        // Older Claude Code versions, and any future rename, must keep the
        // three original fields working rather than failing the whole parse.
        let body = r#"{
            "sessionId": "abc",
            "cwd": "/tmp/x",
            "startedAt": 42
        }"#;
        let got = parse_pid_json(body).expect("happy path");
        assert_eq!(got.session_id, "abc");
        assert_eq!(got.cwd.as_deref(), Some("/tmp/x"));
        assert_eq!(got.started_at_ms, 42);
        assert_eq!(got.status, None);
        assert_eq!(got.waiting_for, None);
        assert_eq!(got.status_updated_at_ms, None);
    }

    // -----------------------------------------------------------------
    // accumulate_jsonl_stats
    // -----------------------------------------------------------------

    #[test]
    fn accumulate_jsonl_stats_empty_input() {
        let s = accumulate_jsonl_stats("");
        assert_eq!(s.input_tokens, 0);
        assert_eq!(s.output_tokens, 0);
        assert_eq!(s.model, None);
        assert_eq!(s.permission_mode, None);
        assert_eq!(s.message_count, 0);
        assert_eq!(s.tool_count, 0);
    }

    #[test]
    fn accumulate_jsonl_stats_sums_assistant_usage() {
        let jsonl = "\
{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-4-7\",\"usage\":{\"input_tokens\":100,\"output_tokens\":50},\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}\n\
{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"more\"}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-4-7\",\"usage\":{\"input_tokens\":200,\"output_tokens\":80},\"content\":[{\"type\":\"text\",\"text\":\"k\"}]}}\n";
        let s = accumulate_jsonl_stats(jsonl);
        assert_eq!(s.input_tokens, 300);
        assert_eq!(s.output_tokens, 130);
        assert_eq!(s.model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(s.message_count, 4);
        assert_eq!(s.tool_count, 0);
    }

    #[test]
    fn accumulate_jsonl_stats_counts_tool_use_blocks() {
        let jsonl = "\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-4-7\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5},\"content\":[{\"type\":\"text\",\"text\":\"running\"},{\"type\":\"tool_use\",\"id\":\"a\",\"name\":\"Bash\",\"input\":{}}]}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-4-7\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1},\"content\":[{\"type\":\"tool_use\",\"id\":\"b\",\"name\":\"Read\",\"input\":{}},{\"type\":\"tool_use\",\"id\":\"c\",\"name\":\"Edit\",\"input\":{}}]}}\n";
        let s = accumulate_jsonl_stats(jsonl);
        assert_eq!(s.tool_count, 3);
        assert_eq!(s.message_count, 2);
    }

    #[test]
    fn accumulate_jsonl_stats_picks_latest_permission_mode_and_model() {
        let jsonl = "\
{\"type\":\"permission-mode\",\"permissionMode\":\"default\"}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-haiku-4-5\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1},\"content\":[]}}\n\
{\"type\":\"permission-mode\",\"permissionMode\":\"plan\"}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-4-7\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1},\"content\":[]}}\n";
        let s = accumulate_jsonl_stats(jsonl);
        assert_eq!(s.permission_mode.as_deref(), Some("plan"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-4-7"));
    }

    #[test]
    fn accumulate_jsonl_stats_skips_malformed_lines() {
        let jsonl = "\
not-json-at-all\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"m\",\"usage\":{\"input_tokens\":7,\"output_tokens\":3},\"content\":[]}}\n\
{}\n\
{\"type\":\"hook_success\"}\n";
        let s = accumulate_jsonl_stats(jsonl);
        assert_eq!(s.input_tokens, 7);
        assert_eq!(s.output_tokens, 3);
        assert_eq!(s.message_count, 1);
    }

    #[test]
    fn accumulate_jsonl_stats_ignores_non_user_assistant_types_for_message_count() {
        let jsonl = "\
{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n\
{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"m\",\"usage\":{\"input_tokens\":0,\"output_tokens\":0},\"content\":[]}}\n\
{\"type\":\"system\",\"content\":\"x\"}\n\
{\"type\":\"hook_success\"}\n\
{\"type\":\"permission-mode\",\"permissionMode\":\"default\"}\n";
        let s = accumulate_jsonl_stats(jsonl);
        assert_eq!(s.message_count, 2);
    }

    // -----------------------------------------------------------------
    // probe_claude_status_for_pid (filesystem integration)
    // -----------------------------------------------------------------

    #[test]
    fn probe_claude_status_for_pid_happy_path() {
        let dir = unique_temp_subdir("status-happy");
        let sessions = dir.join(".claude").join("sessions");
        let projects = dir.join(".claude").join("projects").join("-tmp-x");
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::create_dir_all(&projects).unwrap();

        // Pretend our own pid is the claude descendant.
        let our_pid = std::process::id();
        std::fs::write(
            sessions.join(format!("{}.json", our_pid)),
            format!(
                r#"{{"pid":{p},"sessionId":"abc-123","cwd":"/tmp/x","startedAt":42}}"#,
                p = our_pid
            ),
        )
        .unwrap();
        std::fs::write(
            projects.join("abc-123.jsonl"),
            "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-4-7\",\"usage\":{\"input_tokens\":10,\"output_tokens\":4},\"content\":[]}}\n",
        ).unwrap();

        let saved = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &dir);
        }

        let status = read_status_for_pid(our_pid)
            .expect("synthetic sessions/<pid>.json should be picked up");
        assert_eq!(status.session_id, "abc-123");
        assert_eq!(status.input_tokens, 10);
        assert_eq!(status.output_tokens, 4);
        assert_eq!(status.model.as_deref(), Some("claude-opus-4-7"));

        match saved {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn probe_claude_status_for_pid_missing_sessions_file() {
        let dir = unique_temp_subdir("status-missing");
        let saved = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &dir);
        }
        // No sessions/ directory at all.
        assert!(read_status_for_pid(99999).is_none());
        match saved {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------
    // parse_job_state
    // -----------------------------------------------------------------

    #[test]
    fn parse_job_state_reads_a_live_forked_job() {
        // Shape taken verbatim from a live ~/.claude/jobs/<short>/state.json.
        let body = r#"{
            "state": "blocked",
            "detail": "awaiting work description or task",
            "tempo": "blocked",
            "inFlight": { "tasks": 2, "queued": 0, "kinds": [], "drainableMonitors": 0 },
            "sessionId": "21259340-a8c8-4b0d-8b7b-95a5679175c9",
            "cwd": "/Users/u/proj",
            "forkParentSessionId": "08d0883d-c1ff-44ae-b972-ea8e9b4d3b1b",
            "interactiveLineage": true,
            "updatedAt": "2026-08-20T12:32:06.282Z"
        }"#;
        let got = parse_job_state(body).expect("happy path");
        assert_eq!(got.session_id, "21259340-a8c8-4b0d-8b7b-95a5679175c9");
        assert_eq!(
            got.fork_parent_session_id,
            "08d0883d-c1ff-44ae-b972-ea8e9b4d3b1b"
        );
        assert_eq!(got.tempo.as_deref(), Some("blocked"));
        assert_eq!(got.in_flight_tasks, 2);
        assert_eq!(got.updated_at.as_deref(), Some("2026-08-20T12:32:06.282Z"));
        assert_eq!(
            got.detail.as_deref(),
            Some("awaiting work description or task")
        );
    }

    #[test]
    fn parse_job_state_drops_a_job_with_no_fork_parent() {
        // Without a parent there is no pane to attribute the job to, and
        // guessing by cwd is exactly the wrong answer when two panes share a
        // directory. Dropping is the honest outcome.
        let body = r#"{
            "sessionId": "abc",
            "tempo": "active",
            "updatedAt": "2026-08-20T12:32:06.282Z"
        }"#;
        assert!(parse_job_state(body).is_none());
    }

    #[test]
    fn parse_job_state_defaults_in_flight_tasks_when_absent() {
        // The `state: failed` / `tempo: idle` shape, also taken from disk. It
        // has no inFlight block at all.
        let body = r#"{
            "state": "failed",
            "tempo": "idle",
            "sessionId": "c6b15c14-7337-4b00-a733-e883c536e479",
            "forkParentSessionId": "parent-1",
            "updatedAt": "2026-08-20T12:30:39.083Z"
        }"#;
        let got = parse_job_state(body).expect("happy path");
        assert_eq!(got.in_flight_tasks, 0);
        assert_eq!(got.tempo.as_deref(), Some("idle"));
    }

    #[test]
    fn parse_job_state_returns_none_for_junk() {
        assert!(parse_job_state("not json").is_none());
        assert!(parse_job_state("{}").is_none());
    }

    // ---- attach_background ----

    fn pid_session(session_id: &str, status: &str) -> PidSession {
        PidSession {
            session_id: session_id.to_string(),
            cwd: None,
            started_at_ms: 0,
            status: Some(status.to_string()),
            waiting_for: None,
            status_updated_at_ms: None,
        }
    }

    fn job(session_id: &str, parent: &str, tempo: &str) -> JobState {
        JobState {
            session_id: session_id.to_string(),
            fork_parent_session_id: parent.to_string(),
            tempo: Some(tempo.to_string()),
            in_flight_tasks: 0,
            updated_at: Some("2026-08-31T12:00:00.000Z".to_string()),
            detail: None,
        }
    }

    #[test]
    fn attach_background_pairs_a_job_with_its_forking_session() {
        let sessions = vec![(7, pid_session("parent-a", "idle"))];
        let jobs = vec![job("job-1", "parent-a", "active")];
        let out = attach_background(sessions, &jobs);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].pty_id, 7);
        assert_eq!(out[0].status.as_deref(), Some("idle"));
        assert_eq!(out[0].background.len(), 1);
        assert_eq!(out[0].background[0].session_id, "job-1");
        assert_eq!(out[0].background[0].tempo.as_deref(), Some("active"));
    }

    #[test]
    fn attach_background_ignores_a_job_belonging_to_another_session() {
        let sessions = vec![(7, pid_session("parent-a", "idle"))];
        let jobs = vec![job("job-1", "someone-else", "active")];
        let out = attach_background(sessions, &jobs);
        assert_eq!(out.len(), 1);
        assert!(out[0].background.is_empty());
    }

    #[test]
    fn attach_background_gives_each_pty_only_its_own_jobs() {
        let sessions = vec![
            (7, pid_session("parent-a", "idle")),
            (9, pid_session("parent-b", "busy")),
        ];
        let jobs = vec![
            job("job-1", "parent-a", "active"),
            job("job-2", "parent-b", "blocked"),
            job("job-3", "parent-a", "idle"),
        ];
        let out = attach_background(sessions, &jobs);
        let a = out.iter().find(|s| s.pty_id == 7).unwrap();
        let b = out.iter().find(|s| s.pty_id == 9).unwrap();
        assert_eq!(a.background.len(), 2);
        assert_eq!(b.background.len(), 1);
        assert_eq!(b.background[0].session_id, "job-2");
    }

    #[test]
    fn attach_background_returns_empty_for_no_sessions() {
        let out = attach_background(Vec::new(), &[job("job-1", "parent-a", "active")]);
        assert!(out.is_empty());
    }
}
