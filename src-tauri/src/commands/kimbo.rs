use std::fs;
use tauri::{AppHandle, Manager};

/// Writes the three bundled shell-init snippets to ~/.config/kimbo/shell/
/// and returns the absolute path of the target directory. Idempotent.
#[tauri::command]
pub fn write_kimbo_shell_scripts(app: AppHandle) -> Result<String, String> {
    let cfg_dir = kimbo_config::AppConfig::config_dir().join("shell");

    fs::create_dir_all(&cfg_dir)
        .map_err(|e| format!("create_dir_all failed: {e}"))?;

    let resolver = app.path();
    for name in ["kimbo-init.zsh", "kimbo-init.bash", "kimbo-init.fish"] {
        let src = resolver
            .resolve(
                format!("resources/shell/{name}"),
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| format!("resolve {name}: {e}"))?;
        let dst = cfg_dir.join(name);
        let bytes = fs::read(&src).map_err(|e| format!("read {src:?}: {e}"))?;
        fs::write(&dst, bytes).map_err(|e| format!("write {dst:?}: {e}"))?;
    }

    Ok(cfg_dir.to_string_lossy().into_owned())
}
