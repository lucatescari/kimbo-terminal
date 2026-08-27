//! The theme contract: one description of every colour key a Kimbo theme may
//! set, shared by the app, the themes repo's validator and the theme creator
//! site.
//!
//! The contract is hand-authored rather than generated, because what it
//! describes lives in two languages: defaults in `JsonTheme::resolve()` here,
//! and the CSS variable mapping in `src-ui/theme.ts`. A test in each language
//! asserts the contract still matches its half. Enforcement is the point; if a
//! key is added to the code and not the contract, a build goes red.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractGroup {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractKey {
    pub key: String,
    pub default: String,
    pub required: bool,
    pub resolved_field: String,
    pub css_vars: Vec<String>,
    pub group: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContract {
    pub version: u32,
    pub xterm_major: u32,
    pub groups: Vec<ContractGroup>,
    pub keys: Vec<ContractKey>,
}

impl ThemeContract {
    /// Load `theme-contract.json` from the workspace root.
    pub fn load_from_repo_root(root: &Path) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(root.join("theme-contract.json"))?;
        Ok(serde_json::from_str(&raw)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::JsonTheme;

    fn repo_root() -> std::path::PathBuf {
        // CARGO_MANIFEST_DIR is crates/kimbo-config; the root is two up.
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn contract_defaults_match_the_resolver() {
        let contract = ThemeContract::load_from_repo_root(&repo_root()).unwrap();

        // An empty theme resolves entirely to defaults, which is exactly what
        // the contract claims those defaults are.
        let empty = JsonTheme::empty_for_tests();
        let resolved = serde_json::to_value(empty.resolve()).unwrap();

        for k in &contract.keys {
            let actual = resolved
                .get(&k.resolved_field)
                .unwrap_or_else(|| panic!("contract names unknown field {}", k.resolved_field))
                .as_str()
                .unwrap();
            assert_eq!(
                actual, k.default,
                "default drift for {}: resolver says {}, contract says {}",
                k.key, actual, k.default
            );
        }
    }

    #[test]
    fn contract_covers_every_resolved_colour_field() {
        let contract = ThemeContract::load_from_repo_root(&repo_root()).unwrap();
        let resolved = serde_json::to_value(JsonTheme::empty_for_tests().resolve()).unwrap();

        // Everything on the resolved theme except these two is a colour and
        // must therefore be described by the contract. A new field added to
        // JsonResolvedTheme without a contract entry fails here.
        let non_colour = ["name", "theme_type"];
        let described: Vec<&str> = contract
            .keys
            .iter()
            .map(|k| k.resolved_field.as_str())
            .collect();

        for (field, _) in resolved.as_object().unwrap() {
            if non_colour.contains(&field.as_str()) {
                continue;
            }
            assert!(
                described.contains(&field.as_str()),
                "resolved field {field} has no contract entry"
            );
        }
    }
}
