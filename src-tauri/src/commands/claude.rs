use crate::pty_manager::PtyManager;
use kimbo_terminal::{probe_claude_session_for_pid, ClaudeStatus, probe_claude_status_for_pid};
use serde::Serialize;
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
#[tauri::command]
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
#[tauri::command]
pub fn claude_status(
    id: u32,
    manager: State<'_, PtyManager>,
) -> Result<Option<ClaudeStatus>, String> {
    let pid = manager.pid_of(id)?;
    Ok(probe_claude_status_for_pid(pid))
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
#[tauri::command]
pub fn claude_account_info(
    force_refresh: bool,
    cache: State<'_, ClaudeAccountCache>,
) -> Result<Option<AccountInfo>, String> {
    let current_signal = kimbo_claude_statusline::default_claude_json_path()
        .and_then(|p| kimbo_claude_statusline::read_account_email_from(&p));
    let mut guard = cache.inner.lock().unwrap();
    if should_refetch(guard.as_ref(), current_signal.as_deref(), force_refresh) {
        *guard = Some(CacheEntry { info: fetch_account_info(), signal: current_signal });
    }
    Ok(guard.as_ref().and_then(|e| e.info.clone()))
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    fn info(email: &str) -> AccountInfo {
        AccountInfo { logged_in: true, email: Some(email.to_string()), subscription_type: None }
    }
    fn entry(signal: &str) -> CacheEntry {
        CacheEntry { info: Some(info(signal)), signal: Some(signal.to_string()) }
    }

    #[test]
    fn refetches_when_never_fetched() {
        assert!(should_refetch(None, Some("a@x.com"), false));
    }

    #[test]
    fn no_refetch_when_signal_unchanged() {
        assert!(!should_refetch(Some(&entry("a@x.com")), Some("a@x.com"), false));
    }

    #[test]
    fn refetches_when_signal_changes() {
        // The login-switch case behind issue #9.
        assert!(should_refetch(Some(&entry("a@x.com")), Some("b@x.com"), false));
    }

    #[test]
    fn refetches_on_force_even_when_signal_unchanged() {
        assert!(should_refetch(Some(&entry("a@x.com")), Some("a@x.com"), true));
    }

    #[test]
    fn refetches_when_signal_goes_from_some_to_none() {
        // Logout: oauthAccount disappears from ~/.claude.json.
        assert!(should_refetch(Some(&entry("a@x.com")), None, false));
    }
}
