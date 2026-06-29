//! Window-level translucency — transparent webview + macOS vibrancy behind it.
//!
//! Refocus glitches are an **upstream class of bugs** (transparent `NSWindow` +
//! `WKWebView`), not something Kimbo can fully “solve” in isolation. Background:
//! [tauri#8255](https://github.com/tauri-apps/tauri/issues/8255) (Sonoma+),
//! WebKit/Wry layering ([wry#981](https://github.com/tauri-apps/wry/issues/981)).
//! Mitigations here: vibrancy reset, 1px resize, shadow off→on, `NSWindow`/`WKWebView`
//! transparency flags, optional `KIMBO_MACOS_ACCESSORY_ACTIVATION` in `main.rs`.

use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{AppHandle, Emitter, Manager};

static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

/// Shared implementation for `invoke` and for `WindowEvent::Focused` on the backend.
///
/// WKWebView often keeps a stale opaque layer after the window was inactive; the
/// desktop/`NSVisualEffectView` blur then stops showing through until we reset.
pub(crate) fn refresh_main_window_translucency<R: tauri::Runtime>(
    win: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        refresh_macos(win)
    }
}

#[cfg(target_os = "macos")]
fn refresh_macos<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_app_kit::{NSColor, NSView, NSWindow};
    use objc2_foundation::{ns_string, NSNumber};
    use objc2_web_kit::WKWebView;
    use std::thread;
    use std::time::Duration;
    use window_vibrancy::{
        apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
    };

    // tauri#8255 / window-vibrancy#112: toggling shadow forces AppKit to rebuild the
    // transparent compositing stack (matches community overlay apps).
    let _ = win.set_shadow(false);

    let _ = win.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));

    win.with_webview(|webview| unsafe {
        let wk = &*webview.inner().cast::<WKWebView>();

        let (): () = msg_send![wk, setOpaque: false];

        let no = NSNumber::numberWithBool(false);
        let (): () = msg_send![wk, setValue: Some(&*no), forKey: ns_string!("drawsBackground")];

        let clear = NSColor::colorWithSRGBRed_green_blue_alpha(0., 0., 0., 0.);
        wk.setUnderPageBackgroundColor(Some(&clear));

        let view_ref: &NSView = &*std::ptr::from_ref(wk).cast::<NSView>();

        // Walk the entire superview chain (WryWebViewParent → theme frame → …).
        let mut cursor = view_ref.superview();
        let mut depth = 0_u32;
        while let Some(v) = cursor {
            if depth > 48 {
                break;
            }
            let (): () = msg_send![&*v, setOpaque: false];
            v.setNeedsDisplay(true);
            cursor = v.superview();
            depth += 1;
        }

        let nw = webview.ns_window().cast::<NSWindow>();
        if !nw.is_null() {
            let nsw = &*nw;
            nsw.setOpaque(false);
            nsw.setTitlebarAppearsTransparent(true);
            if let Some(cv) = nsw.contentView() {
                let (): () = msg_send![&*cv, setOpaque: false];
                cv.setNeedsDisplay(true);
            }
            nsw.invalidateShadow();
            // Flush window-server compositing after focus transitions (pairs with
            // setNeedsDisplay on views; complements shadow/resize workarounds).
            nsw.display();
        }
    })
    .map_err(|e| e.to_string())?;

    let _ = clear_vibrancy(win);
    // `FollowsWindowActiveState` can leave the material visually stuck after
    // Cmd-Tab on some macOS versions; keep the blur logically “active” so
    // refocus matches our forced WKWebView transparency refresh.
    apply_vibrancy(
        win,
        NSVisualEffectMaterial::Tooltip,
        Some(NSVisualEffectState::Active),
        Some(14.0),
    )
    .map_err(|e| e.to_string())?;

    if let Ok(sz) = win.outer_size() {
        let w = sz.width.max(2);
        let h = sz.height.max(2);
        let _ = win.set_size(tauri::PhysicalSize::new(w + 1, h + 1));
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
    }

    // Defer the shadow restore onto tokio's blocking pool (reused across
    // events) instead of spawning a fresh OS thread per refocus — rapid
    // Cmd-Tab no longer stacks N short-lived threads.
    let win_delayed = win.clone();
    tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(130));
        let inner = win_delayed.clone();
        let _ = win_delayed.run_on_main_thread(move || {
            let _ = inner.set_shadow(true);
            let _ = inner.with_webview(|webview| unsafe {
                let nw = webview.ns_window().cast::<NSWindow>();
                if !nw.is_null() {
                    let nsw = &*nw;
                    nsw.invalidateShadow();
                }
            });
        });
    });

    Ok(())
}

/// Gentle initial translucency for a freshly-created window: make the webview
/// background transparent and mount the `NSVisualEffectView` blur behind it.
///
/// This is the SAME setup the main window gets in `main.rs` (and the only
/// translucency work safe to do at creation time). It deliberately does NOT
/// call [`refresh_main_window_translucency`] — that heavier path reaches into
/// the live `WKWebView` view hierarchy (`with_webview`) and runs a resize
/// dance, which on a brand-new window whose webview has not yet loaded leaves
/// the content unrendered and the window non-interactive (no drag region). The
/// heavy refresh runs later, on the first `Focused(true)` (see
/// [`attach_window_lifecycle`]), by which point the webview is loaded.
pub(crate) fn apply_initial_vibrancy<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    let _ = win.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        if let Err(e) = apply_vibrancy(
            win,
            NSVisualEffectMaterial::Tooltip,
            Some(NSVisualEffectState::Active),
            Some(14.0),
        ) {
            log::warn!("apply_vibrancy failed; falling back to no blur: {e:?}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win;
    }
}

/// Wire the per-window lifecycle events. Attached to the main window in
/// `main.rs` setup AND to every secondary window built by `new_window`, so
/// ANY window refreshes its (otherwise stale, opaque) WKWebView layer on
/// refocus and runs the close behavior appropriate to its role.
///
/// Close semantics differ by window:
/// - the MAIN window's close is the app's quit affordance — prevent the close
///   and let the frontend's `quit-requested` listener run the confirm flow;
/// - a SECONDARY window's close affects only that window, but still routes
///   through the frontend's busy-check + confirm (window-targeted) so a window
///   running a process can't be closed without warning; the frontend then
///   destroy()s the window.
pub(crate) fn attach_window_lifecycle<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    let is_main = win.label() == "main";
    let app_handle = win.app_handle().clone();
    let win_focus = win.clone();
    let win_close = win.clone();
    win.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if is_main {
                // Main window == the whole app. Keep the existing flow:
                // prevent the close and let the frontend's `quit-requested`
                // listener run confirmAndQuit() → invoke("quit_app").
                // TODO(multi-window): scope with emit_to — `quit-requested`
                // broadcasts, so every window runs confirmAndQuit (harmless,
                // whichever calls quit_app first wins, but wasteful).
                api.prevent_close();
                let _ = app_handle.emit("quit-requested", ());
            } else {
                // Secondary window: only this window should go away, but it
                // must NOT close while a process is running without warning.
                // Prevent the close and hand control to the frontend
                // (window-targeted so only this window reacts): it runs the
                // same busy-check + confirm the quit path uses, then
                // destroy()s the window — destroy bypasses CloseRequested, so
                // there's no confirm loop. On cancel the window stays open.
                //
                // Per-window PTY teardown is handled on the frontend: the
                // window-close-requested handler (requestCloseCurrentWindow in
                // close-confirm.ts) closes this window's panes' PTYs before
                // destroy(), so their process trees are reaped now rather than
                // by kill_all at app exit. (PtyManager is keyed by session id,
                // not window, so it can't scope the teardown itself.)
                api.prevent_close();
                let _ = win_close.emit_to(win_close.label(), "window-close-requested", ());
            }
        }
        tauri::WindowEvent::Focused(true) => {
            if let Err(e) = refresh_main_window_translucency(&win_focus) {
                log::warn!("refresh translucency on focus: {e}");
            }
            // TODO(multi-window): scope with emit_to — `kimbo-window-focused`
            // broadcasts, so every window repaints (applyRoot/fitAllPanes) on
            // any focus change. Harmless, just wasteful.
            let _ = app_handle.emit("kimbo-window-focused", ());
        }
        _ => {}
    });
}

#[tauri::command]
pub async fn new_window(app: AppHandle) -> Result<(), String> {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::SeqCst);
    let label = format!("win-{n}");
    let win =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Kimbo")
            .inner_size(1200.0, 800.0)
            .min_inner_size(600.0, 400.0)
            .decorations(false)
            .transparent(true)
            .shadow(true)
            // Let the click that activates a background window land in the webview, so
            // clicking a pane focuses that pane on the first click. See
            // src-ui/window-activation.ts for the matching destructive-click guard.
            .accept_first_mouse(true)
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .build()
            .map_err(|e| e.to_string())?;
    // Same lifecycle wiring the main window gets in main.rs setup: refresh
    // translucency on refocus + role-appropriate close handling.
    attach_window_lifecycle(&win);
    // Mirror the main window's creation path exactly: gentle initial vibrancy
    // only. The heavy refresh_main_window_translucency runs on the first
    // Focused(true) (wired above) once the webview has loaded — running it here,
    // before the webview loads, left the window with no content and no drag
    // region.
    apply_initial_vibrancy(&win);
    Ok(())
}

#[tauri::command]
pub fn refresh_window_translucency(app: AppHandle) -> Result<(), String> {
    // Try the currently focused window first; fall back to "main".
    // Note: get_focused_window() requires the "unstable" feature in Tauri 2, so
    // we iterate webview_windows() and pick whichever reports is_focused() == true.
    let win = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| "no window".to_string())?;
    refresh_main_window_translucency(&win)
}
