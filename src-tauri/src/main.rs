#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod pty_manager;

use pty_manager::PtyManager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;
use commands::theme::ThemeState;
use commands::update::UpdateState;

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::new())
        .manage(ThemeState::default())
        .manage(UpdateState::default())
        .setup(|app| {
            // Build native macOS menu bar.
            let handle = app.handle();

            let settings = MenuItem::with_id(handle, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
            let quit = MenuItem::with_id(handle, "quit", "Quit Kimbo", true, Some("CmdOrCtrl+Q"))?;

            let app_menu = Submenu::with_items(handle, "Kimbo", true, &[
                &PredefinedMenuItem::about(handle, Some("About Kimbo"), None)?,
                &PredefinedMenuItem::separator(handle)?,
                &settings,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::services(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &quit,
            ])?;

            let new_tab = MenuItem::with_id(handle, "new_tab", "New Tab", true, Some("CmdOrCtrl+T"))?;
            let close_pane = MenuItem::with_id(handle, "close_pane", "Close Pane", true, Some("CmdOrCtrl+W"))?;
            let close_tab = MenuItem::with_id(handle, "close_tab", "Close Tab", true, Some("CmdOrCtrl+Shift+W"))?;

            let file_menu = Submenu::with_items(handle, "File", true, &[
                &new_tab,
                &PredefinedMenuItem::separator(handle)?,
                &close_pane,
                &close_tab,
            ])?;

            let edit_menu = Submenu::with_items(handle, "Edit", true, &[
                &PredefinedMenuItem::copy(handle, None)?,
                &PredefinedMenuItem::paste(handle, None)?,
                &PredefinedMenuItem::select_all(handle, None)?,
            ])?;

            let split_v = MenuItem::with_id(handle, "split_vertical", "Split Vertical", true, Some("CmdOrCtrl+D"))?;
            let split_h = MenuItem::with_id(handle, "split_horizontal", "Split Horizontal", true, Some("CmdOrCtrl+Shift+D"))?;

            let view_menu = Submenu::with_items(handle, "View", true, &[
                &split_v,
                &split_h,
            ])?;

            let window_menu = Submenu::with_items(handle, "Window", true, &[
                &PredefinedMenuItem::minimize(handle, None)?,
                &PredefinedMenuItem::maximize(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::fullscreen(handle, None)?,
            ])?;

            let menu = Menu::with_items(handle, &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
            ])?;

            app.set_menu(menu)?;

            // Handle menu item clicks → emit events to frontend.
            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                match id {
                    "quit" => app_handle.exit(0),
                    "settings" | "new_tab" | "close_pane" | "close_tab"
                    | "split_vertical" | "split_horizontal" => {
                        let _ = app_handle.emit("menu-action", id);
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty::create_pty,
            commands::pty::write_pty,
            commands::pty::resize_pty,
            commands::pty::close_pty,
            commands::pty::get_cwd,
            commands::theme::get_theme,
            commands::theme::list_unified_themes,
            commands::theme::install_theme,
            commands::theme::delete_theme,
            commands::config::get_config,
            commands::config::save_config,
            commands::kimbo::write_kimbo_shell_scripts,
            commands::workspace::list_projects,
            commands::update::check_for_updates,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
