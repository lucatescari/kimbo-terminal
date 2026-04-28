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

/// Cache for account info. Loaded once at app start (or on first
/// command invocation), refreshed on demand via `force_refresh`.
#[derive(Default)]
pub struct ClaudeAccountCache {
    inner: Mutex<Option<AccountInfo>>,
}

fn fetch_account_info() -> Option<AccountInfo> {
    let output = Command::new("claude")
        .args(["auth", "status"])
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
    let mut guard = cache.inner.lock().unwrap();
    if guard.is_none() || force_refresh {
        *guard = fetch_account_info();
    }
    Ok(guard.clone())
}
