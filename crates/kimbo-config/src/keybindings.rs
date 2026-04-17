use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Definition of a bindable action with its label and default key.
pub struct KeybindingDef {
    pub id: &'static str,
    pub label: &'static str,
    pub default_key: &'static str,
}

/// Canonical list of all user-editable keybindings.
/// Keys use GPUI format (dash-separated): "cmd-shift-d".
pub const KEYBINDING_DEFS: &[KeybindingDef] = &[
    KeybindingDef { id: "copy", label: "Copy", default_key: "cmd-c" },
    KeybindingDef { id: "paste", label: "Paste", default_key: "cmd-v" },
    KeybindingDef { id: "new_tab", label: "New Tab", default_key: "cmd-t" },
    KeybindingDef { id: "close_tab", label: "Close Tab", default_key: "cmd-shift-w" },
    KeybindingDef { id: "next_tab", label: "Next Tab", default_key: "cmd-]" },
    KeybindingDef { id: "prev_tab", label: "Previous Tab", default_key: "cmd-[" },
    KeybindingDef { id: "split_vertical", label: "Split Vertical", default_key: "cmd-d" },
    KeybindingDef { id: "split_horizontal", label: "Split Horizontal", default_key: "cmd-shift-d" },
    KeybindingDef { id: "close_pane", label: "Close Pane", default_key: "cmd-w" },
    KeybindingDef { id: "focus_pane_up", label: "Focus Up", default_key: "cmd-up" },
    KeybindingDef { id: "focus_pane_down", label: "Focus Down", default_key: "cmd-down" },
    KeybindingDef { id: "focus_pane_left", label: "Focus Left", default_key: "cmd-left" },
    KeybindingDef { id: "focus_pane_right", label: "Focus Right", default_key: "cmd-right" },
    KeybindingDef { id: "new_window", label: "New Window", default_key: "cmd-n" },
    KeybindingDef { id: "open_launcher", label: "Open Launcher", default_key: "cmd-o" },
    KeybindingDef { id: "open_settings", label: "Settings", default_key: "cmd-," },
    KeybindingDef { id: "scroll_page_up", label: "Scroll Page Up", default_key: "shift-pageup" },
    KeybindingDef { id: "scroll_page_down", label: "Scroll Page Down", default_key: "shift-pagedown" },
];

/// Convert a GPUI key string like "cmd-shift-d" to a display string like "⌘⇧D".
pub fn display_key(binding: &str) -> String {
    binding
        .split('-')
        .map(|part| match part {
            "cmd" => "\u{2318}".to_string(),  // ⌘
            "ctrl" => "\u{2303}".to_string(),  // ⌃
            "alt" => "\u{2325}".to_string(),   // ⌥
            "shift" => "\u{21e7}".to_string(), // ⇧
            "up" => "\u{2191}".to_string(),    // ↑
            "down" => "\u{2193}".to_string(),  // ↓
            "left" => "\u{2190}".to_string(),  // ←
            "right" => "\u{2192}".to_string(), // →
            "escape" => "Esc".to_string(),
            "enter" => "\u{21b5}".to_string(), // ↵
            "backspace" => "\u{232b}".to_string(), // ⌫
            "tab" => "\u{21e5}".to_string(),   // ⇥
            "pageup" => "PgUp".to_string(),
            "pagedown" => "PgDn".to_string(),
            "space" => "Space".to_string(),
            other => other.to_uppercase(),
        })
        .collect::<Vec<_>>()
        .join("")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindingSet {
    pub bindings: HashMap<String, String>,
}

impl Default for KeybindingSet {
    fn default() -> Self {
        let bindings = KEYBINDING_DEFS
            .iter()
            .map(|def| (def.id.to_string(), def.default_key.to_string()))
            .collect();
        Self { bindings }
    }
}

impl KeybindingSet {
    /// Look up the key combo string for a given action name.
    /// Falls back to the default if not present in the map.
    pub fn get(&self, action: &str) -> &str {
        if let Some(key) = self.bindings.get(action) {
            key.as_str()
        } else {
            KEYBINDING_DEFS
                .iter()
                .find(|d| d.id == action)
                .map(|d| d.default_key)
                .unwrap_or("")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_keybindings() {
        let kb = KeybindingSet::default();
        assert_eq!(kb.get("copy"), "cmd-c");
        assert_eq!(kb.get("paste"), "cmd-v");
        assert_eq!(kb.get("split_vertical"), "cmd-d");
        assert_eq!(kb.get("split_horizontal"), "cmd-shift-d");
        assert_eq!(kb.get("new_tab"), "cmd-t");
        assert_eq!(kb.get("close_tab"), "cmd-shift-w");
    }

    #[test]
    fn test_display_key() {
        assert_eq!(display_key("cmd-c"), "\u{2318}C");
        assert_eq!(display_key("cmd-shift-d"), "\u{2318}\u{21e7}D");
        assert_eq!(display_key("cmd-up"), "\u{2318}\u{2191}");
        assert_eq!(display_key("shift-pageup"), "\u{21e7}PgUp");
        assert_eq!(display_key("cmd-,"), "\u{2318},");
    }

    #[test]
    fn test_get_with_override() {
        let mut kb = KeybindingSet::default();
        kb.bindings.insert("copy".to_string(), "ctrl-c".to_string());
        assert_eq!(kb.get("copy"), "ctrl-c");
        // Others unchanged.
        assert_eq!(kb.get("paste"), "cmd-v");
    }

    #[test]
    fn test_get_unknown_falls_back() {
        let kb = KeybindingSet::default();
        assert_eq!(kb.get("nonexistent"), "");
    }

    #[test]
    fn test_serialize_roundtrip() {
        let kb = KeybindingSet::default();
        let toml_str = toml::to_string_pretty(&kb).unwrap();
        let parsed: KeybindingSet = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.bindings.len(), kb.bindings.len());
        for (action, key) in &kb.bindings {
            assert_eq!(parsed.get(action), key.as_str());
        }
    }
}
