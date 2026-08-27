#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod notify_socket;
mod pty_manager;

use commands::theme::ThemeState;
use commands::update::UpdateCache;
use pty_manager::PtyManager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, State};

#[tauri::command]
fn quit_app(app: tauri::AppHandle, manager: State<'_, PtyManager>) {
    // app.exit(0) does NOT run Drop on managed State, so without this
    // explicit sweep every shell would reparent to launchd on quit. Must
    // run BEFORE app.exit; SIGHUP is synchronous, the 150ms SIGKILL
    // escalation runs in detached threads per session.
    manager.kill_all();
    if let Some(sock_path) = notify_socket::socket_path() {
        let _ = std::fs::remove_file(&sock_path);
    }
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

/// Sentry ingest DSN. A client DSN is a write-only ingest key, safe to embed.
const SENTRY_DSN: &str = "https://91e26e0fae89dda62952208d70b71c94@o4511292110536704.ingest.de.sentry.io/4511529624076368";

fn main() {
    env_logger::init();

    // Opt-in anonymous crash/error reporting. OFF unless the user enabled it in
    // Settings → Privacy (persisted to config.toml so we can read it here, before
    // the webview exists). When disabled, the client gets no DSN → nothing is
    // ever sent. Takes effect on launch (toggling requires a restart).
    let telemetry_on = kimbo_config::AppConfig::load()
        .map(|c| c.telemetry.enabled)
        .unwrap_or(false);
    let sentry_client = sentry::init((
        if telemetry_on { Some(SENTRY_DSN) } else { None },
        sentry::ClientOptions {
            release: sentry::release_name!(),
            // Never attach IP/username/etc. And scrub the machine hostname,
            // which the Rust SDK would otherwise auto-fill into server_name.
            send_default_pii: false,
            before_send: Some(std::sync::Arc::new(|mut event| {
                event.server_name = None;
                event.user = None;
                Some(event)
            })),
            ..Default::default()
        },
    ));
    // Native crash (minidump) capture; no-ops when the client has no DSN.
    #[cfg(not(target_os = "ios"))]
    let _sentry_minidump = tauri_plugin_sentry::minidump::init(&sentry_client);

    tauri::Builder::default()
        .plugin(tauri_plugin_sentry::init(&sentry_client))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::new())
        .manage(commands::claude::ClaudeAccountCache::default())
        .manage(ThemeState::default())
        .manage(UpdateCache::default())
        .setup(|app| {
            // Stage Manager / Sonoma (tauri#8255): optional dock-less activation policy.
            // Launch with `KIMBO_MACOS_ACCESSORY_ACTIVATION=1` if translucency still breaks on refocus.
            #[cfg(target_os = "macos")]
            if std::env::var("KIMBO_MACOS_ACCESSORY_ACTIVATION")
                .ok()
                .as_deref()
                == Some("1")
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                log::info!("ActivationPolicy::Accessory (KIMBO_MACOS_ACCESSORY_ACTIVATION=1)");
            }

            // Force the webview's background to transparent so the CSS rounded
            // body shows the desktop through at the corners. Without this,
            // WebKit paints an opaque default background behind our HTML and
            // fills the rounded gaps — making the window look square even
            // with `transparent: true` on the window. This is the macOS
            // workaround tracked in tauri-apps/wry#981.
            if let Some(win) = app.get_webview_window("main") {
                // Make the webview background transparent and mount the
                // NSVisualEffectView blur behind it so the Background-opacity
                // slider (src-ui/settings.ts, --app-alpha in style.css) has
                // something to show through. Shared with new_window() so every
                // window's creation-time translucency is identical.
                commands::window::apply_initial_vibrancy(&win);
            }

            // Build native macOS menu bar. Accelerators come from the user's
            // persisted keybinding overrides (config.keybindings.bindings),
            // falling back to defaults — so rebinds survive restart. macOS
            // requires these key-equivalents to live on the menu, not the
            // webview; the webview (keys.ts) only handles the non-menu shortcuts.
            let handle = app.handle();
            let kb = kimbo_config::AppConfig::load()
                .map(|c| c.keybindings.bindings)
                .unwrap_or_default();
            let accel = |id: &str, default_chord: &str| {
                Some(commands::keybinds::accelerator_for(&kb, id, default_chord))
            };

            let settings = MenuItem::with_id(
                handle,
                "settings",
                "Settings...",
                true,
                accel("settings", "cmd-,"),
            )?;
            let quit =
                MenuItem::with_id(handle, "quit", "Quit Kimbo", true, accel("quit", "cmd-q"))?;

            let app_menu = Submenu::with_items(
                handle,
                "Kimbo",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Kimbo"), None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &settings,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::services(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &quit,
                ],
            )?;

            let new_window = MenuItem::with_id(
                handle,
                "new_window",
                "New Window",
                true,
                accel("new_window", "cmd-n"),
            )?;
            let new_tab = MenuItem::with_id(
                handle,
                "new_tab",
                "New Tab",
                true,
                accel("new_tab", "cmd-t"),
            )?;
            let close_pane = MenuItem::with_id(
                handle,
                "close_pane",
                "Close Pane",
                true,
                accel("close_pane", "cmd-w"),
            )?;
            let close_tab = MenuItem::with_id(
                handle,
                "close_tab",
                "Close Tab",
                true,
                accel("close_tab", "cmd-shift-w"),
            )?;
            let reopen_tab = MenuItem::with_id(
                handle,
                "reopen_tab",
                "Reopen Closed Tab",
                true,
                accel("reopen_tab", "cmd-shift-t"),
            )?;

            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &new_window,
                    &new_tab,
                    &PredefinedMenuItem::separator(handle)?,
                    &close_pane,
                    &close_tab,
                    &reopen_tab,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;

            let split_v = MenuItem::with_id(
                handle,
                "split_vertical",
                "Split Vertical",
                true,
                accel("split_vertical", "cmd-d"),
            )?;
            let split_h = MenuItem::with_id(
                handle,
                "split_horizontal",
                "Split Horizontal",
                true,
                accel("split_horizontal", "cmd-shift-d"),
            )?;

            let view_menu = Submenu::with_items(handle, "View", true, &[&split_v, &split_h])?;

            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::fullscreen(handle, None)?,
                ],
            )?;

            let menu = Menu::with_items(
                handle,
                &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
            )?;

            app.set_menu(menu)?;

            // Handle menu item clicks → emit events to frontend. "quit" is
            // forwarded like every other menu-action (it used to call
            // app_handle.exit(0) directly, which bypassed the JS
            // confirm-on-quit flow); the frontend's menu-action listener
            // now routes it through confirmAndQuit() so the pref is
            // respected no matter which quit affordance was used.
            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                match id {
                    "new_window" => {
                        let app2 = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::window::new_window(app2).await;
                        });
                    }
                    "settings" | "new_tab" | "close_pane" | "close_tab" | "reopen_tab"
                    | "split_vertical" | "split_horizontal" | "quit" => {
                        if let Some(win) = app_handle
                            .webview_windows()
                            .into_values()
                            .find(|w| w.is_focused().unwrap_or(false))
                        {
                            // Target ONLY the focused window. `Emitter::emit`
                            // on a WebviewWindow delegates to the shared
                            // manager and broadcasts to every window, so the
                            // focus check was a no-op — New Tab/Split/Close
                            // fanned out to all windows. `emit_to(label)`
                            // scopes delivery (the frontend listens via the
                            // current webview window, so only this window's
                            // listener fires).
                            let _ = win.emit_to(win.label(), "menu-action", id);
                        } else {
                            // No focused window (rare) → fall back to a
                            // broadcast so the action isn't simply dropped.
                            let _ = app_handle.emit("menu-action", id);
                        }
                    }
                    _ => {}
                }
            });

            // Wire the main window's lifecycle (close → JS confirm/quit flow;
            // refocus → translucency refresh). The same helper is attached to
            // every secondary window inside `new_window`, so all windows get
            // the refocus fix and a role-appropriate close.
            if let Some(win) = app.get_webview_window("main") {
                commands::window::attach_window_lifecycle(&win);
            }

            if let Ok(sidecar) = commands::claude_rate_limits::sidecar_path() {
                let path_str = sidecar.to_string_lossy().to_string();
                if let Err(e) = commands::claude_rate_limits::rewrite_wrapper(&path_str) {
                    log::warn!("rewrite_wrapper failed: {e}");
                }
            }

            if let Ok(sidecar) = commands::claude_notifications::sidecar_path() {
                let path_str = sidecar.to_string_lossy().to_string();
                if let Err(e) = commands::claude_notifications::rewrite_wrapper(&path_str) {
                    log::warn!("notify rewrite_wrapper failed: {e}");
                }
            }

            // Notify-socket listener — receives events from kimbo-claude-notify hooks.
            {
                let app_handle = app.handle().clone();
                if let Some(sock_path) = notify_socket::socket_path() {
                    notify_socket::spawn_listener(sock_path, move |ev| {
                        if let Err(e) = app_handle.emit("claude-notify", &ev) {
                            log::warn!("emit claude-notify failed: {e}");
                        }
                    });
                } else {
                    log::warn!("notify-socket: $HOME unset; skipping listener");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty::create_pty,
            commands::pty::write_pty,
            commands::pty::resize_pty,
            commands::pty::close_pty,
            commands::pty::get_cwd,
            commands::pty::pty_is_busy,
            commands::claude::probe_claude_session,
            commands::claude::claude_status,
            commands::claude::claude_account_info,
            commands::claude::claude_agents,
            commands::claude::claude_session_origin,
            commands::theme::get_theme,
            commands::theme::list_unified_themes,
            commands::theme::install_theme,
            commands::theme::install_theme_from_file,
            commands::theme::delete_theme,
            commands::config::get_config,
            commands::config::save_config,
            commands::config::get_config_path,
            commands::config::reset_config,
            commands::config::open_config_in_editor,
            commands::kimbo::write_kimbo_shell_scripts,
            commands::keybinds::set_menu_accelerator,
            commands::path::resolve_existing_path,
            commands::workspace::list_projects,
            commands::update::check_update,
            commands::update::install_update,
            commands::update::reinstall_stable,
            commands::window::refresh_window_translucency,
            commands::window::new_window,
            commands::claude_rate_limits::claude_rate_limits,
            commands::claude_rate_limits::claude_rate_limits_install,
            commands::claude_rate_limits::claude_rate_limits_uninstall,
            commands::claude_notifications::claude_notifications_install,
            commands::claude_notifications::claude_notifications_uninstall,
            commands::claude_notifications::claude_notifications_status,
            quit_app,
            set_window_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
