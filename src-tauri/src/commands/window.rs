//! Window-level translucency — transparent webview + macOS vibrancy behind it.
//!
//! Refocus glitches are an **upstream class of bugs** (transparent `NSWindow` +
//! `WKWebView`), not something Kimbo can fully “solve” in isolation. Background:
//! [tauri#8255](https://github.com/tauri-apps/tauri/issues/8255) (Sonoma+),
//! WebKit/Wry layering ([wry#981](https://github.com/tauri-apps/wry/issues/981)).
//! Mitigations here: vibrancy reset, 1px resize, shadow off→on, `NSWindow`/`WKWebView`
//! transparency flags, optional `KIMBO_MACOS_ACCESSORY_ACTIVATION` in `main.rs`.

use tauri::{AppHandle, Manager};

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

#[tauri::command]
pub fn refresh_window_translucency(app: AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window("main") else {
        return Ok(());
    };
    refresh_main_window_translucency(&win)
}
