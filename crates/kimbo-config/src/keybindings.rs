use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// User keybinding overrides, persisted in config.toml as `id -> chord`
/// (canonical lowercase-dash format, e.g. "cmd-shift-d"). The frontend owns the
/// default bindings (see src-ui/keybindings.ts), so this map stores ONLY the
/// user's overrides and its default is empty.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KeybindingSet {
    #[serde(default)]
    pub bindings: HashMap<String, String>,
}

impl KeybindingSet {
    /// The override chord for an action id, if the user has set one.
    pub fn get(&self, action: &str) -> Option<&str> {
        self.bindings.get(action).map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_empty() {
        assert!(KeybindingSet::default().bindings.is_empty());
        assert_eq!(KeybindingSet::default().get("new_tab"), None);
    }

    #[test]
    fn get_returns_override() {
        let mut kb = KeybindingSet::default();
        kb.bindings.insert("new_tab".into(), "cmd-alt-t".into());
        assert_eq!(kb.get("new_tab"), Some("cmd-alt-t"));
        assert_eq!(kb.get("close_tab"), None);
    }

    #[test]
    fn serialize_roundtrip() {
        let mut kb = KeybindingSet::default();
        kb.bindings.insert("new_tab".into(), "cmd-alt-t".into());
        let s = toml::to_string_pretty(&kb).unwrap();
        let parsed: KeybindingSet = toml::from_str(&s).unwrap();
        assert_eq!(parsed.get("new_tab"), Some("cmd-alt-t"));
    }
}
