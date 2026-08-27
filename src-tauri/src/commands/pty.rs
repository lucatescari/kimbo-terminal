use crate::pty_manager::PtyManager;
use kimbo_config::AppConfig;
use tauri::{AppHandle, State};

/// Create a PTY pane.
///
/// `command`, when given, is an argv the pane runs before dropping to an
/// interactive shell. Used to open a pane directly on a Claude session; None
/// gives an ordinary shell pane.
#[tauri::command]
pub fn create_pty(
    cwd: Option<String>,
    command: Option<Vec<String>>,
    app: AppHandle,
    manager: State<'_, PtyManager>,
) -> Result<u32, String> {
    let shell = AppConfig::load()
        .ok()
        .map(|c| c.general.default_shell)
        .filter(|s| !s.is_empty());
    manager.create(cwd, shell, command, app)
}

#[tauri::command]
pub fn write_pty(id: u32, data: String, manager: State<'_, PtyManager>) -> Result<(), String> {
    manager.write(id, data.as_bytes())
}

#[tauri::command]
pub fn resize_pty(
    id: u32,
    cols: u16,
    rows: u16,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    manager.resize(id, cols, rows)
}

#[tauri::command]
pub fn close_pty(id: u32, manager: State<'_, PtyManager>) -> Result<(), String> {
    manager.close(id)
}

#[tauri::command]
pub fn get_cwd(id: u32, manager: State<'_, PtyManager>) -> Result<Option<String>, String> {
    manager.get_cwd(id)
}

#[tauri::command]
pub fn pty_is_busy(id: u32, manager: State<'_, PtyManager>) -> Result<bool, String> {
    manager.is_busy(id)
}
