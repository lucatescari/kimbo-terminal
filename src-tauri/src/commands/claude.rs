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
/// found", "lsof unavailable", and "budget exceeded". Errors only on
/// genuinely unexpected conditions (PTY id unknown).
#[tauri::command]
pub fn probe_claude_session(
    id: u32,
    manager: State<'_, PtyManager>,
) -> Result<Option<ClaudeResume>, String> {
    let pid = manager.pid_of(id)?;
    Ok(probe_claude_session_for_pid(pid).map(|uuid| ClaudeResume { uuid }))
}
