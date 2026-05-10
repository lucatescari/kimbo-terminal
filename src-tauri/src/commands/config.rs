use kimbo_config::AppConfig;

#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    AppConfig::load().map_err(|e| format!("failed to load config: {}", e))
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    config.save().map_err(|e| format!("failed to save config: {}", e))
}

#[tauri::command]
pub fn get_config_path() -> String {
    AppConfig::config_path().to_string_lossy().to_string()
}

/// Opens the user's config.toml in the system's default editor for that
/// file extension. Materializes the file with current settings first so
/// `open` doesn't fail on a missing path the very first time the user
/// hits this button (config is normally loaded with defaults in-memory
/// and only persisted on the next setting change).
#[tauri::command]
pub fn open_config_in_editor() -> Result<(), String> {
    let path = AppConfig::config_path();
    if !path.exists() {
        AppConfig::load()
            .map_err(|e| format!("load config: {}", e))?
            .save()
            .map_err(|e| format!("write config: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    let cmd = ("open", vec![path.as_os_str().to_owned()]);
    #[cfg(target_os = "linux")]
    let cmd = ("xdg-open", vec![path.as_os_str().to_owned()]);
    #[cfg(target_os = "windows")]
    let cmd: (&str, Vec<std::ffi::OsString>) = (
        "cmd",
        vec![
            std::ffi::OsString::from("/C"),
            std::ffi::OsString::from("start"),
            std::ffi::OsString::from(""),
            path.as_os_str().to_owned(),
        ],
    );

    std::process::Command::new(cmd.0)
        .args(cmd.1)
        .spawn()
        .map_err(|e| format!("spawn editor: {}", e))?;
    Ok(())
}
