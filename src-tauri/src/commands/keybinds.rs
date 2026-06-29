use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Runtime};

// The native-menu-owned shortcuts (settings, quit, new_tab, close_pane,
// close_tab, reopen_tab, split_vertical, split_horizontal) and their default
// accelerators are declared inline in main.rs's menu builder. macOS reserves
// these key-equivalents, so they live on the menu, not the webview. Keep them
// in sync with the `menu: true` entries in src-ui/keybindings.ts.

/// Convert a canonical chord ("cmd-shift-d") to a Tauri/muda accelerator
/// string ("CmdOrCtrl+Shift+D"). Mirrors chordToDisplayParts' modifier names;
/// muda parses these case-insensitively.
pub fn chord_to_accelerator(chord: &str) -> String {
    chord
        .split('-')
        .map(|p| match p {
            "cmd" => "CmdOrCtrl".to_string(),
            "ctrl" => "Control".to_string(),
            "alt" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "up" => "Up".to_string(),
            "down" => "Down".to_string(),
            "left" => "Left".to_string(),
            "right" => "Right".to_string(),
            other if other.chars().count() == 1 => other.to_uppercase(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Accelerator for a menu id given the user's override map (falls back to the
/// default chord). Used when building the menu at startup.
pub fn accelerator_for(
    bindings: &HashMap<String, String>,
    id: &str,
    default_chord: &str,
) -> String {
    let chord = bindings
        .get(id)
        .map(String::as_str)
        .unwrap_or(default_chord);
    chord_to_accelerator(chord)
}

/// Find a MenuItem by id, recursing one level into submenus (Menu::get and
/// Submenu::get only search their own level).
fn find_item<R: Runtime>(menu: &Menu<R>, id: &str) -> Option<MenuItem<R>> {
    if let Some(kind) = menu.get(id) {
        if let Some(item) = kind.as_menuitem() {
            return Some(item.clone());
        }
    }
    for kind in menu.items().ok()? {
        if let Some(submenu) = kind.as_submenu() {
            if let Some(found) = submenu.get(id) {
                if let Some(item) = found.as_menuitem() {
                    return Some(item.clone());
                }
            }
        }
    }
    None
}

/// Update a native menu item's accelerator after the user rebinds a
/// menu-owned shortcut. `chord` is the canonical form ("cmd-shift-d"), or None
/// to clear. set_accelerator dispatches to the main thread internally.
#[tauri::command]
pub fn set_menu_accelerator<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    chord: Option<String>,
) -> Result<(), String> {
    let menu = app
        .menu()
        .ok_or_else(|| "no application menu".to_string())?;
    let item = find_item(&menu, &id).ok_or_else(|| format!("menu item '{}' not found", id))?;
    let accel = chord.as_deref().map(chord_to_accelerator);
    item.set_accelerator(accel).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_chords_to_accelerators() {
        assert_eq!(chord_to_accelerator("cmd-t"), "CmdOrCtrl+T");
        assert_eq!(chord_to_accelerator("cmd-shift-d"), "CmdOrCtrl+Shift+D");
        assert_eq!(chord_to_accelerator("cmd-,"), "CmdOrCtrl+,");
        assert_eq!(chord_to_accelerator("cmd-up"), "CmdOrCtrl+Up");
        assert_eq!(chord_to_accelerator("cmd-alt-k"), "CmdOrCtrl+Alt+K");
    }

    #[test]
    fn accelerator_for_prefers_override() {
        let mut b = HashMap::new();
        b.insert("new_tab".to_string(), "cmd-alt-t".to_string());
        assert_eq!(accelerator_for(&b, "new_tab", "cmd-t"), "CmdOrCtrl+Alt+T");
        assert_eq!(accelerator_for(&b, "quit", "cmd-q"), "CmdOrCtrl+Q");
    }
}
