use crate::pty_manager::PtyManager;
use kimbo_terminal::probe_claude_session_for_pid;
use serde::Serialize;
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
