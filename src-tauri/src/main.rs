#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod pty_manager;

use pty_manager::PtyManager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use commands::theme::ThemeState;
use commands::update::UpdateState;

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Pin the NSWindow's appearance to the active Kimbo theme so the
/// NSVisualEffectView (mounted in setup) picks up a matching light/dark
/// vibrancy material regardless of the system-wide appearance.
///
/// Without this, a user running macOS in dark mode but using the Kimbo
/// light theme sees a dark blur behind the translucent chrome — the
/// window ends up grayer, not lighter, as the opacity slider goes down.
#[tauri::command]
fn set_window_theme(app: tauri::AppHandle, theme_type: String) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let t = match theme_type.as_str() {
            "light" => Some(tauri::Theme::Light),
            "dark" => Some(tauri::Theme::Dark),
            _ => None, // high-contrast, custom, or unknown: follow system.
        };
        let _ = win.set_theme(t);
    }
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::new())
        .manage(ThemeState::default())
        .manage(UpdateState::default())
        .setup(|app| {
            // Force the webview's background to transparent so the CSS rounded
            // body shows the desktop through at the corners. Without this,
            // WebKit paints an opaque default background behind our HTML and
            // fills the rounded gaps — making the window look square even
            // with `transparent: true` on the window. This is the macOS
            // workaround tracked in tauri-apps/wry#981.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));

                // Mount NSVisualEffectView behind the (transparent) webview so
                // the Background-opacity slider (src-ui/settings.ts, --app-alpha
                // in style.css) has something to show through. Tooltip is the
                // thinnest adaptive material — it shows significantly more of
                // what's behind the window than the heavier WindowBackground /
                // UnderWindowBackground materials, which matches the "real
                // translucent terminal" aesthetic the user wanted at low
                // slider values. Adapts to light/dark via set_window_theme.
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    if let Err(e) = apply_vibrancy(
                        &win,
                        NSVisualEffectMaterial::Tooltip,
                        None,
                        Some(14.0),
                    ) {
                        log::warn!("apply_vibrancy failed; falling back to no blur: {e:?}");
                    }
                }
            }

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
            commands::theme::install_theme_from_file,
            commands::theme::delete_theme,
            commands::config::get_config,
            commands::config::save_config,
            commands::kimbo::write_kimbo_shell_scripts,
            commands::workspace::list_projects,
            commands::update::check_for_updates,
            quit_app,
            set_window_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
