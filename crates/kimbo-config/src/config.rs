use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::keybindings::KeybindingSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub general: GeneralConfig,
    pub font: FontConfig,
    pub theme: ThemeConfig,
    pub scrollback: ScrollbackConfig,
    pub cursor: CursorConfig,
    pub keybindings: KeybindingSet,
    pub workspace: WorkspaceConfig,
    pub kimbo: KimboConfig,
    pub updates: UpdatesConfig,
    pub welcome: WelcomeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GeneralConfig {
    pub default_shell: String,
    pub default_layout: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct FontConfig {
    pub family: String,
    pub size: f64,
    pub line_height: f64,
    pub ligatures: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeConfig {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScrollbackConfig {
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CursorConfig {
    pub style: String,
    pub blink: bool,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceConfig {
    pub auto_detect: bool,
    pub scan_dirs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KimboConfig {
    pub enabled: bool,
    pub corner: String,
    pub shell_integration: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UpdatesConfig {
    pub auto_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WelcomeConfig {
    pub show_on_startup: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            general: GeneralConfig::default(),
            font: FontConfig::default(),
            theme: ThemeConfig::default(),
            scrollback: ScrollbackConfig::default(),
            cursor: CursorConfig::default(),
            keybindings: KeybindingSet::default(),
            workspace: WorkspaceConfig::default(),
            kimbo: KimboConfig::default(),
            updates: UpdatesConfig::default(),
            welcome: WelcomeConfig::default(),
        }
    }
}

impl Default for GeneralConfig {
    fn default() -> Self {
        let default_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Self {
            default_shell,
            default_layout: "single".to_string(),
        }
    }
}

impl Default for FontConfig {
    fn default() -> Self {
        Self {
            family: "JetBrains Mono".to_string(),
            size: 14.0,
            line_height: 1.2,
            ligatures: true,
        }
    }
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            name: "kimbo-dark".to_string(),
        }
    }
}

impl Default for ScrollbackConfig {
    fn default() -> Self {
        Self { lines: 10_000 }
    }
}

impl Default for CursorConfig {
    fn default() -> Self {
        Self {
            style: "block".to_string(),
            blink: true,
        }
    }
}


impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            auto_detect: true,
            scan_dirs: vec!["~/Projects".to_string()],
        }
    }
}

impl Default for KimboConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            corner: "bottom_right".to_string(),
            shell_integration: false,
        }
    }
}

impl Default for UpdatesConfig {
    fn default() -> Self {
        Self { auto_check: true }
    }
}

impl Default for WelcomeConfig {
    fn default() -> Self {
        Self { show_on_startup: true }
    }
}

impl AppConfig {
    /// Returns the default configuration directory (~/.config/kimbo/).
    pub fn config_dir() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("~/.config"))
            .join("kimbo")
    }

    /// Returns the default configuration file path (~/.config/kimbo/config.toml).
    pub fn config_path() -> PathBuf {
        Self::config_dir().join("config.toml")
    }

    /// Loads the configuration from the default path.
    /// Returns the default configuration if the file does not exist.
    pub fn load() -> Result<Self> {
        let path = Self::config_path();
        if !path.exists() {
            log::info!("Config file not found at {:?}, using defaults", path);
            return Ok(Self::default());
        }
        Self::load_from(&path)
    }

    /// Loads the configuration from a specific file path.
    pub fn load_from(path: &PathBuf) -> Result<Self> {
        let content =
            fs::read_to_string(path).with_context(|| format!("Failed to read config from {:?}", path))?;
        let config: AppConfig =
            toml::from_str(&content).with_context(|| format!("Failed to parse config from {:?}", path))?;
        Ok(config)
    }

    /// Saves the configuration to the default path, creating directories as needed.
    pub fn save(&self) -> Result<()> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create config directory {:?}", parent))?;
        }
        let content =
            toml::to_string_pretty(self).context("Failed to serialize config to TOML")?;
        fs::write(&path, content)
            .with_context(|| format!("Failed to write config to {:?}", path))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.font.family, "JetBrains Mono");
        assert_eq!(config.font.size, 14.0);
        assert_eq!(config.font.line_height, 1.2);
        assert!(config.font.ligatures);
        assert_eq!(config.theme.name, "kimbo-dark");
        assert_eq!(config.scrollback.lines, 10_000);
        assert_eq!(config.cursor.style, "block");
        assert!(config.cursor.blink);
        assert_eq!(config.general.default_layout, "single");
        assert!(config.workspace.auto_detect);
        assert_eq!(config.workspace.scan_dirs, vec!["~/Projects"]);
        assert!(config.kimbo.enabled);
        assert_eq!(config.kimbo.corner, "bottom_right");
    }

    #[test]
    fn test_parse_minimal_toml() {
        let toml_str = r#"
[font]
size = 16.0
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        // Overridden value
        assert_eq!(config.font.size, 16.0);
        // Defaults still apply
        assert_eq!(config.font.family, "JetBrains Mono");
        assert_eq!(config.theme.name, "kimbo-dark");
        assert_eq!(config.scrollback.lines, 10_000);
    }

    #[test]
    fn test_parse_full_toml() {
        let toml_str = r#"
[general]
default_shell = "/bin/bash"
default_layout = "split"

[font]
family = "Fira Code"
size = 12.0
line_height = 1.4
ligatures = false

[theme]
name = "catppuccin-latte"

[scrollback]
lines = 5000

[cursor]
style = "underline"
blink = false

[workspace]
auto_detect = false
scan_dirs = ["~/Code", "~/Work"]
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.general.default_shell, "/bin/bash");
        assert_eq!(config.general.default_layout, "split");
        assert_eq!(config.font.family, "Fira Code");
        assert_eq!(config.font.size, 12.0);
        assert_eq!(config.font.line_height, 1.4);
        assert!(!config.font.ligatures);
        assert_eq!(config.theme.name, "catppuccin-latte");
        assert_eq!(config.scrollback.lines, 5000);
        assert_eq!(config.cursor.style, "underline");
        assert!(!config.cursor.blink);
        assert!(!config.workspace.auto_detect);
        assert_eq!(config.workspace.scan_dirs, vec!["~/Code", "~/Work"]);
    }

    #[test]
    fn test_roundtrip_serialize() {
        let config = AppConfig::default();
        let toml_str = toml::to_string_pretty(&config).unwrap();
        let parsed: AppConfig = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.font.family, config.font.family);
        assert_eq!(parsed.font.size, config.font.size);
        assert_eq!(parsed.theme.name, config.theme.name);
        assert_eq!(parsed.scrollback.lines, config.scrollback.lines);
        assert_eq!(parsed.cursor.style, config.cursor.style);
        assert_eq!(parsed.cursor.blink, config.cursor.blink);
    }

    #[test]
    fn test_load_from_file() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");

        let toml_str = r#"
[font]
family = "Monaco"
size = 18.0

[theme]
name = "kimbo-dark"
"#;
        std::fs::write(&config_path, toml_str).unwrap();

        let path = config_path.to_path_buf();
        let config = AppConfig::load_from(&path).unwrap();
        assert_eq!(config.font.family, "Monaco");
        assert_eq!(config.font.size, 18.0);
        assert_eq!(config.theme.name, "kimbo-dark");
        // Defaults for unspecified fields
        assert_eq!(config.scrollback.lines, 10_000);
    }

    #[test]
    fn test_default_kimbo_config() {
        let config = AppConfig::default();
        assert!(config.kimbo.enabled);
        assert_eq!(config.kimbo.corner, "bottom_right");
        assert!(!config.kimbo.shell_integration);
    }

    #[test]
    fn test_parse_kimbo_toml() {
        let toml_str = r#"
[kimbo]
enabled = false
corner = "top_left"
shell_integration = true
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert!(!config.kimbo.enabled);
        assert_eq!(config.kimbo.corner, "top_left");
        assert!(config.kimbo.shell_integration);
    }

    #[test]
    fn test_kimbo_config_missing_uses_defaults() {
        let toml_str = r#"
[font]
size = 16.0
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert!(config.kimbo.enabled);
        assert_eq!(config.kimbo.corner, "bottom_right");
    }

    #[test]
    fn test_default_updates_config() {
        let config = AppConfig::default();
        assert!(config.updates.auto_check);
    }

    #[test]
    fn test_parse_updates_toml() {
        let toml_str = r#"
[updates]
auto_check = false
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert!(!config.updates.auto_check);
    }

    #[test]
    fn test_updates_config_missing_uses_defaults() {
        let toml_str = r#"
[font]
size = 16.0
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert!(config.updates.auto_check);
    }

    #[test]
    fn test_default_welcome_config() {
        let config = AppConfig::default();
        assert!(config.welcome.show_on_startup);
    }

    #[test]
    fn test_parse_welcome_toml() {
        let toml_str = r#"
[welcome]
show_on_startup = false
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert!(!config.welcome.show_on_startup);
    }

    #[test]
    fn test_welcome_config_missing_uses_defaults() {
        let toml_str = r#"
[font]
size = 16.0
"#;
        let config: AppConfig = toml::from_str(toml_str).unwrap();
        assert!(config.welcome.show_on_startup);
    }
}
