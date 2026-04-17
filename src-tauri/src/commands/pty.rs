use crate::pty_manager::PtyManager;
use kimbo_config::AppConfig;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn create_pty(
    cwd: Option<String>,
    app: AppHandle,
    manager: State<'_, PtyManager>,
) -> Result<u32, String> {
    let shell = AppConfig::load()
        .ok()
        .map(|c| c.general.default_shell)
        .filter(|s| !s.is_empty());
    manager.create(cwd, shell, app)
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
