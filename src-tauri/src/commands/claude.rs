use crate::pty_manager::PtyManager;
use kimbo_terminal::{
    probe_claude_session_for_pid, probe_claude_status_for_pid, probe_claude_tab_states,
    ClaudeStatus, PtyClaudeState,
};
use serde::Serialize;
use std::io::Read;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

#[derive(Serialize)]
pub struct ClaudeResume {
    pub uuid: String,
}

/// Walk the PTY's process descendants and return the running Claude Code
/// session UUID, if any. Best-effort; returns `Ok(None)` for "no claude
/// found" and "budget exceeded". Errors only on genuinely unexpected
/// conditions (PTY id unknown).
///
/// The probe needs the PTY's cwd to fall back to the disk-mtime tier
/// when the running claude has no `--resume <uuid>` in its args. The
/// cwd is read from the same `PtySession` accessor used by `get_cwd`.
// `(async)` forces this synchronous body to run on the async runtime's
// thread pool instead of inline on the macOS main/UI thread. The probe
// shells out to `ps` and walks the process tree + filesystem; on the main
// thread that work froze the window (spinning beachball). See the HUD poll
// in src-ui/panes.ts which calls this every 2s per pane.
#[tauri::command(async)]
pub fn probe_claude_session(
    id: u32,
    manager: State<'_, PtyManager>,
) -> Result<Option<ClaudeResume>, String> {
    let pid = manager.pid_of(id)?;
    let cwd = manager.get_cwd(id).ok().flatten();
    let result = probe_claude_session_for_pid(pid, cwd.as_deref());
    Ok(result.map(|uuid| ClaudeResume { uuid }))
}

/// Walk the PTY's process descendants and return the live Claude Code
/// session status (session id, model, tokens, etc.) for the running
/// `claude` if any. Best-effort; returns `Ok(None)` for "no claude
/// running" and "missing sessions file". Errors only on PTY id unknown.
// `(async)` keeps the `ps`-based process-tree probe off the main/UI thread
// (the HUD polls this every 2s per pane). See `probe_claude_session`.
#[tauri::command(async)]
pub fn claude_status(
    id: u32,
    manager: State<'_, PtyManager>,
) -> Result<Option<ClaudeStatus>, String> {
    let pid = manager.pid_of(id)?;
    Ok(probe_claude_status_for_pid(pid))
}

/// Live Claude Code activity for a batch of PTYs, for the tab activity dots.
///
/// Separate from `claude_status` on purpose. That one serves the per-pane HUD,
/// which is skipped for panes in hidden tabs and when the HUD preference is
/// off (see `chooseHudAction`). Background tabs are exactly the ones an
/// activity dot is for, so this must not share that gating — and because one
/// call covers every pane with a single `ps`, it is cheaper than the per-pane
/// probes even while covering strictly more panes.
///
/// A PTY id we do not know, or one with no Claude session, is silently
/// omitted. This is polled on a timer; a hard error per unknown id would make
/// a closing pane a recurring failure.
///
/// `Ok(None)` means the probe itself failed to learn anything (no `HOME`, or
/// the `ps` snapshot missed its deadline) — distinct from `Ok(Some(vec![]))`,
/// the genuine "no Claude anywhere right now" answer. The TS side must not
/// treat the two the same: see `realProbe` in `src-ui/tab-activity.ts`.
// `(async)` keeps the ps snapshot and the two directory reads off the
// macOS main/UI thread. See `probe_claude_session`.
#[tauri::command(async)]
pub fn claude_tab_states(
    ids: Vec<u32>,
    manager: State<'_, PtyManager>,
) -> Result<Option<Vec<PtyClaudeState>>, String> {
    let pty_pids: Vec<(u32, u32)> = ids
        .into_iter()
        .filter_map(|id| manager.pid_of(id).ok().map(|pid| (id, pid)))
        .collect();
    Ok(probe_claude_tab_states(&pty_pids))
}

#[derive(Clone, Serialize)]
pub struct AccountInfo {
    pub logged_in: bool,
    pub email: Option<String>,
    pub subscription_type: Option<String>,
}

#[derive(serde::Deserialize)]
struct AuthStatusRaw {
    #[serde(rename = "loggedIn")]
    logged_in: bool,
    email: Option<String>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
}

/// A cached `claude auth status` result plus the account-email "signal" read
/// from `~/.claude.json` at the time it was fetched. The signal lets us detect
/// a login switch cheaply (no shell-out) and refetch only when it changes.
pub struct CacheEntry {
    /// The fetched account info. `None` means the fetch ran but the user was
    /// logged out / claude wasn't available — distinct from "never fetched".
    pub info: Option<AccountInfo>,
    /// `oauthAccount.emailAddress` from `~/.claude.json` when this was fetched.
    pub signal: Option<String>,
}

/// Cache for account info. The first call (or any call whose account-email
/// signal differs from the cached one, or `force_refresh`) shells out and
/// refreshes; otherwise the cached value is returned. This auto-invalidates
/// on a login switch without polling `claude auth status` (issue #9).
#[derive(Default)]
pub struct ClaudeAccountCache {
    inner: Mutex<Option<CacheEntry>>,
}

/// Pure cache-decision: should we re-run `claude auth status`?
/// Refetch when forced, when we've never fetched, or when the current account
/// signal differs from the one captured at the last fetch.
fn should_refetch(entry: Option<&CacheEntry>, current_signal: Option<&str>, force: bool) -> bool {
    if force {
        return true;
    }
    match entry {
        None => true,
        Some(e) => e.signal.as_deref() != current_signal,
    }
}

fn fetch_account_info() -> Option<AccountInfo> {
    // Go through login+interactive shell so PATH matches Terminal —
    // a bundled .app launched via launchd only gets the minimal
    // /usr/bin:/bin:/usr/sbin:/sbin and won't find claude otherwise.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = Command::new(&shell)
        .args(["-ilc", "claude auth status"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw: AuthStatusRaw = serde_json::from_slice(&output.stdout).ok()?;
    Some(AccountInfo {
        logged_in: raw.logged_in,
        email: raw.email,
        subscription_type: raw.subscription_type,
    })
}

/// Return the cached `claude auth status` payload. The first call (or
/// any call with `force_refresh: true`) shells out and refreshes the
/// cache. Returns `Ok(None)` when claude isn't installed, the user
/// isn't logged in, or stdout doesn't parse — never errors.
// `(async)` is load-bearing: on its first call this command shells out to
// `$SHELL -ilc "claude auth status"` — an interactive login shell that sources
// the user's full rc files plus the Node `claude` CLI and a network auth check
// (measured 0.8–1.2s here, multi-second on heavy shell configs). As a plain
// synchronous command it ran inline on the macOS main/UI thread, freezing the
// window with a spinning beachball ~2s after launch (the first HUD poll). The
// `(async)` attribute runs the body on the async runtime's thread pool instead.
#[tauri::command(async)]
pub fn claude_account_info(
    force_refresh: bool,
    cache: State<'_, ClaudeAccountCache>,
) -> Result<Option<AccountInfo>, String> {
    let current_signal = kimbo_claude_statusline::default_claude_json_path()
        .and_then(|p| kimbo_claude_statusline::read_account_email_from(&p));
    let mut guard = cache.inner.lock().unwrap_or_else(|e| e.into_inner());
    if should_refetch(guard.as_ref(), current_signal.as_deref(), force_refresh) {
        *guard = Some(CacheEntry {
            info: fetch_account_info(),
            signal: current_signal,
        });
    }
    Ok(guard.as_ref().and_then(|e| e.info.clone()))
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    fn info(email: &str) -> AccountInfo {
        AccountInfo {
            logged_in: true,
            email: Some(email.to_string()),
            subscription_type: None,
        }
    }
    fn entry(signal: &str) -> CacheEntry {
        CacheEntry {
            info: Some(info(signal)),
            signal: Some(signal.to_string()),
        }
    }

    #[test]
    fn refetches_when_never_fetched() {
        assert!(should_refetch(None, Some("a@x.com"), false));
    }

    #[test]
    fn no_refetch_when_signal_unchanged() {
        assert!(!should_refetch(
            Some(&entry("a@x.com")),
            Some("a@x.com"),
            false
        ));
    }

    #[test]
    fn refetches_when_signal_changes() {
        // The login-switch case behind issue #9.
        assert!(should_refetch(
            Some(&entry("a@x.com")),
            Some("b@x.com"),
            false
        ));
    }

    #[test]
    fn refetches_on_force_even_when_signal_unchanged() {
        assert!(should_refetch(
            Some(&entry("a@x.com")),
            Some("a@x.com"),
            true
        ));
    }

    #[test]
    fn refetches_when_signal_goes_from_some_to_none() {
        // Logout: oauthAccount disappears from ~/.claude.json.
        assert!(should_refetch(Some(&entry("a@x.com")), None, false));
    }
}

// ---------------------------------------------------------------------------
// Session lineage: branch and fork detection
// ---------------------------------------------------------------------------

/// One entry from `claude agents --json`.
///
/// That command is a supported CLI surface, which is why it is used here in
/// preference to reading `~/.claude/sessions/*.json` directly: the files are
/// an internal detail, the command is not.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ClaudeAgent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// "interactive" for a session someone is typing in, "background" for one
    /// started by /fork. The distinction decides whether Kimbo attaches to a
    /// session or resumes it.
    pub kind: Option<String>,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub state: Option<String>,
}

/// List every Claude session the CLI knows about, interactive and background.
///
/// Returns an empty list rather than an error when claude is absent or the
/// output does not parse: a missing CLI is a normal state for a terminal that
/// most users run without Claude Code, not a failure worth surfacing.
#[tauri::command(async)]
pub fn claude_agents() -> Result<Vec<ClaudeAgent>, String> {
    // Login-interactive shell so a bundled .app resolves `claude` on PATH;
    // launchd hands the bundle only a minimal PATH. Same reasoning as
    // claude_account_info above.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = match Command::new(&shell)
        .args(["-ilc", "claude agents --json"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Ok(Vec::new()),
    };
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_slice(&output.stdout).unwrap_or_default())
}

/// Pull `forkedFrom.sessionId` out of a transcript's first JSONL record.
///
/// Claude Code writes this on the first line of a session created by /branch,
/// naming the session it descends from. It is the only durable evidence that
/// one conversation came from another, so it is what Kimbo keys branch
/// detection on.
fn parse_forked_from(first_line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(first_line).ok()?;
    v.get("forkedFrom")?
        .get("sessionId")?
        .as_str()
        .map(|s| s.to_string())
}

/// The session `session_id` was branched from, or None if it was not a branch.
///
/// Scans `~/.claude/projects/*/` for the transcript rather than deriving the
/// project directory from a cwd: the directory name is a slugified path whose
/// encoding is Claude Code's business, and a wrong guess would silently report
/// "not a branch" for every session.
#[tauri::command(async)]
pub fn claude_session_origin(session_id: String) -> Result<Option<String>, String> {
    // A session id reaches this function from disk and is about to become a
    // path component. Anything but a plain UUID is refused rather than
    // sanitised, so no traversal can be constructed from it.
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Ok(None);
    }

    let Some(home) = dirs::home_dir() else {
        return Ok(None);
    };
    let projects = home.join(".claude").join("projects");
    let Ok(entries) = std::fs::read_dir(&projects) else {
        return Ok(None);
    };

    for entry in entries.flatten() {
        let candidate = entry.path().join(format!("{session_id}.jsonl"));
        if !candidate.is_file() {
            continue;
        }
        // forkedFrom lives on the first record, so read a bounded prefix
        // instead of a transcript that can run to hundreds of megabytes.
        let Ok(file) = std::fs::File::open(&candidate) else {
            continue;
        };
        let mut first = String::new();
        {
            use std::io::BufRead;
            let mut reader = std::io::BufReader::new(file).take(256 * 1024);
            let _ = reader.read_line(&mut first);
        }
        return Ok(parse_forked_from(&first));
    }
    Ok(None)
}

#[cfg(test)]
mod lineage_tests {
    use super::parse_forked_from;

    // Claude Code writes forkedFrom on the first line of a /branch session,
    // naming the conversation it descends from. It is the only durable record
    // that one session came from another, so misreading it means Kimbo either
    // never offers the split or opens the wrong conversation.
    #[test]
    fn reads_the_origin_from_a_branch_transcript() {
        // Shape taken from a real branched transcript.
        let line = r#"{"parentUuid":null,"type":"attachment","sessionId":"6523937f-34ba-4eec-b5f8-615d4958802f","forkedFrom":{"sessionId":"cec656bf-4b84-4a9f-aba5-91aa97dad6e1","messageUuid":"d4e37dae-1897-4097-97f6-4d836cdffb1a"}}"#;
        assert_eq!(
            parse_forked_from(line).as_deref(),
            Some("cec656bf-4b84-4a9f-aba5-91aa97dad6e1")
        );
    }

    #[test]
    fn returns_none_for_an_ordinary_session() {
        let line = r#"{"leafUuid":"abc","sessionId":"3b9a9439-9eb5-4da3-83a0-3fd527542ce1","type":"summary"}"#;
        assert_eq!(parse_forked_from(line), None);
    }

    #[test]
    fn returns_none_rather_than_failing_on_junk() {
        // Transcripts are appended to by another process; a torn or empty
        // first line must read as "not a branch", never as an error that
        // breaks the poll.
        for line in ["", "   ", "not json", "{", r#"{"forkedFrom":null}"#] {
            assert_eq!(parse_forked_from(line), None, "input: {line:?}");
        }
    }

    #[test]
    fn returns_none_when_forked_from_lacks_a_session_id() {
        // Defensive against a shape change: a forkedFrom without the field we
        // need must not be reported as a usable origin.
        let line = r#"{"forkedFrom":{"messageUuid":"d4e37dae"}}"#;
        assert_eq!(parse_forked_from(line), None);
        let line = r#"{"forkedFrom":{"sessionId":123}}"#;
        assert_eq!(parse_forked_from(line), None);
    }
}
