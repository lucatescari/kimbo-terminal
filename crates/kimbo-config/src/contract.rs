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

/// The contract as it stood when this binary was compiled.
const CONTRACT_JSON: &str = include_str!("../../../theme-contract.json");

impl ThemeContract {
    /// Parse the `theme-contract.json` embedded at compile time.
    ///
    /// Embedded rather than read from disk so this works in a shipped binary,
    /// where the repo the contract lives in is nowhere to be found.
    pub fn load() -> anyhow::Result<Self> {
        Ok(serde_json::from_str(CONTRACT_JSON)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::JsonTheme;
    use std::collections::HashSet;

    #[test]
    fn contract_defaults_match_the_resolver() {
        let contract = ThemeContract::load().unwrap();

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
        let contract = ThemeContract::load().unwrap();
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

    /// A theme whose `colors` map sets every contract key to its own unique
    /// colour, so a resolved value identifies which key it came from.
    /// Mirrors `distinctTheme()` in `src-ui/theme-contract.test.ts`.
    fn distinct_theme(contract: &ThemeContract) -> (JsonTheme, Vec<String>) {
        let sentinels: Vec<String> = (0..contract.keys.len())
            .map(|i| format!("#{:02x}0000", i + 1))
            .collect();
        let colors = contract
            .keys
            .iter()
            .zip(&sentinels)
            .map(|(k, c)| (k.key.clone(), c.clone()))
            .collect();
        let theme = JsonTheme {
            name: "Test".to_string(),
            theme_type: "dark".to_string(),
            author: String::new(),
            version: String::new(),
            colors,
        };
        (theme, sentinels)
    }

    #[test]
    fn contract_keys_are_the_strings_the_resolver_reads() {
        let contract = ThemeContract::load().unwrap();
        let (theme, sentinels) = distinct_theme(&contract);
        let resolved = serde_json::to_value(theme.resolve()).unwrap();

        // The other two tests pin `default` and `resolvedField`; neither
        // notices if `key` stops being the string `resolve()` looks up. That
        // column is the half theme authors type and the creator site emits, so
        // a wrong one means themes the app silently ignores: installed,
        // rendering defaults, with nothing to show why. Giving each key its own
        // colour checks the mapping rather than merely that something was set.
        for (k, sentinel) in contract.keys.iter().zip(&sentinels) {
            let actual = resolved
                .get(&k.resolved_field)
                .unwrap_or_else(|| panic!("contract names unknown field {}", k.resolved_field))
                .as_str()
                .unwrap();
            assert_eq!(
                actual, sentinel,
                "contract key {} does not reach {}: the resolver reads some \
                 other string for that field, so a theme setting {} is ignored",
                k.key, k.resolved_field, k.key
            );
        }
    }

    #[test]
    fn contract_keys_and_resolved_fields_are_unique() {
        let contract = ThemeContract::load().unwrap();

        // Two entries naming the same resolved field would satisfy both
        // coverage tests above - every contract field exists, every resolved
        // field is described - while leaving a real field undescribed. Same for
        // a duplicated key. Compare against the contract's own length rather
        // than a hardcoded 27 so adding a key stays a one-file change.
        let keys: HashSet<&str> = contract.keys.iter().map(|k| k.key.as_str()).collect();
        assert_eq!(
            keys.len(),
            contract.keys.len(),
            "theme-contract.json has duplicate `key` entries"
        );

        let fields: HashSet<&str> = contract
            .keys
            .iter()
            .map(|k| k.resolved_field.as_str())
            .collect();
        assert_eq!(
            fields.len(),
            contract.keys.len(),
            "theme-contract.json has duplicate `resolvedField` entries"
        );
    }
}
