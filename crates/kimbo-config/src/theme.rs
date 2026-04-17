use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Metadata for a theme available in the community repo.
/// Includes the full theme data when successfully fetched, enabling color previews.
#[derive(Debug, Clone)]
pub struct RemoteThemeEntry {
    /// Theme name (filename without .toml extension).
    pub name: String,
    /// Whether this theme is already installed locally.
    pub installed: bool,
    /// The full theme data, fetched from the repo for preview rendering.
    pub theme: Option<Theme>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    pub colors: ThemeColors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeColors {
    pub foreground: String,
    pub background: String,
    pub cursor: String,
    pub selection_bg: String,
    pub selection_fg: String,
    // ANSI 16 colors
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
    // UI chrome
    pub tab_bar_bg: String,
    pub tab_active_bg: String,
    pub tab_inactive_fg: String,
    pub border: String,
    pub active_border: String,
}

/// Pre-resolved theme with all hex strings converted to `(u8, u8, u8)` tuples
/// for fast lookup during rendering. Created via `Theme::resolve()`.
#[derive(Debug, Clone)]
pub struct ResolvedTheme {
    pub name: String,
    // Terminal colors
    pub foreground: (u8, u8, u8),
    pub background: (u8, u8, u8),
    pub cursor: (u8, u8, u8),
    pub selection_bg: (u8, u8, u8),
    pub selection_fg: (u8, u8, u8),
    // ANSI 16
    pub black: (u8, u8, u8),
    pub red: (u8, u8, u8),
    pub green: (u8, u8, u8),
    pub yellow: (u8, u8, u8),
    pub blue: (u8, u8, u8),
    pub magenta: (u8, u8, u8),
    pub cyan: (u8, u8, u8),
    pub white: (u8, u8, u8),
    pub bright_black: (u8, u8, u8),
    pub bright_red: (u8, u8, u8),
    pub bright_green: (u8, u8, u8),
    pub bright_yellow: (u8, u8, u8),
    pub bright_blue: (u8, u8, u8),
    pub bright_magenta: (u8, u8, u8),
    pub bright_cyan: (u8, u8, u8),
    pub bright_white: (u8, u8, u8),
    // UI chrome
    pub tab_bar_bg: (u8, u8, u8),
    pub tab_active_bg: (u8, u8, u8),
    pub tab_inactive_fg: (u8, u8, u8),
    pub border: (u8, u8, u8),
    pub active_border: (u8, u8, u8),
    // Derived: surface color (slightly lighter than background for dividers)
    pub surface: (u8, u8, u8),
}

impl ResolvedTheme {
    /// Convert a `(u8, u8, u8)` tuple to a `u32` suitable for GPUI's `rgb()`.
    pub fn to_rgb(c: (u8, u8, u8)) -> u32 {
        ((c.0 as u32) << 16) | ((c.1 as u32) << 8) | (c.2 as u32)
    }
}

/// Parses a hex color string like "#RRGGBB" or "RRGGBB" into (R, G, B) components.
pub fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

impl Theme {
    /// Resolve all hex color strings into `(u8, u8, u8)` tuples for fast rendering.
    /// Falls back to (0, 0, 0) for any unparseable color.
    pub fn resolve(&self) -> ResolvedTheme {
        let p = |hex: &str| parse_hex(hex).unwrap_or((0, 0, 0));
        let bg = p(&self.colors.background);
        // Derive a surface color: slightly lighter for dark themes, slightly darker for light themes.
        let surface = {
            let luminance = (bg.0 as u16 + bg.1 as u16 + bg.2 as u16) / 3;
            if luminance < 128 {
                // Dark theme: lighten
                (bg.0.saturating_add(18), bg.1.saturating_add(18), bg.2.saturating_add(24))
            } else {
                // Light theme: darken
                (bg.0.saturating_sub(18), bg.1.saturating_sub(18), bg.2.saturating_sub(12))
            }
        };
        ResolvedTheme {
            name: self.name.clone(),
            foreground: p(&self.colors.foreground),
            background: bg,
            cursor: p(&self.colors.cursor),
            selection_bg: p(&self.colors.selection_bg),
            selection_fg: p(&self.colors.selection_fg),
            black: p(&self.colors.black),
            red: p(&self.colors.red),
            green: p(&self.colors.green),
            yellow: p(&self.colors.yellow),
            blue: p(&self.colors.blue),
            magenta: p(&self.colors.magenta),
            cyan: p(&self.colors.cyan),
            white: p(&self.colors.white),
            bright_black: p(&self.colors.bright_black),
            bright_red: p(&self.colors.bright_red),
            bright_green: p(&self.colors.bright_green),
            bright_yellow: p(&self.colors.bright_yellow),
            bright_blue: p(&self.colors.bright_blue),
            bright_magenta: p(&self.colors.bright_magenta),
            bright_cyan: p(&self.colors.bright_cyan),
            bright_white: p(&self.colors.bright_white),
            tab_bar_bg: p(&self.colors.tab_bar_bg),
            tab_active_bg: p(&self.colors.tab_active_bg),
            tab_inactive_fg: p(&self.colors.tab_inactive_fg),
            border: p(&self.colors.border),
            active_border: p(&self.colors.active_border),
            surface,
        }
    }

    /// Returns the Catppuccin Mocha dark theme.
    pub fn catppuccin_mocha() -> Self {
        Self {
            name: "catppuccin-mocha".to_string(),
            version: "1.0.0".to_string(),
            author: "Catppuccin".to_string(),
            colors: ThemeColors {
                foreground: "#cdd6f4".to_string(),
                background: "#1e1e2e".to_string(),
                cursor: "#f5e0dc".to_string(),
                selection_bg: "#585b70".to_string(),
                selection_fg: "#cdd6f4".to_string(),
                // ANSI colors
                black: "#45475a".to_string(),
                red: "#f38ba8".to_string(),
                green: "#a6e3a1".to_string(),
                yellow: "#f9e2af".to_string(),
                blue: "#89b4fa".to_string(),
                magenta: "#f5c2e7".to_string(),
                cyan: "#94e2d5".to_string(),
                white: "#bac2de".to_string(),
                bright_black: "#585b70".to_string(),
                bright_red: "#f38ba8".to_string(),
                bright_green: "#a6e3a1".to_string(),
                bright_yellow: "#f9e2af".to_string(),
                bright_blue: "#89b4fa".to_string(),
                bright_magenta: "#f5c2e7".to_string(),
                bright_cyan: "#94e2d5".to_string(),
                bright_white: "#a6adc8".to_string(),
                // UI chrome
                tab_bar_bg: "#181825".to_string(),
                tab_active_bg: "#1e1e2e".to_string(),
                tab_inactive_fg: "#6c7086".to_string(),
                border: "#313244".to_string(),
                active_border: "#89b4fa".to_string(),
            },
        }
    }

    /// Returns the Catppuccin Latte light theme.
    pub fn catppuccin_latte() -> Self {
        Self {
            name: "catppuccin-latte".to_string(),
            version: "1.0.0".to_string(),
            author: "Catppuccin".to_string(),
            colors: ThemeColors {
                foreground: "#4c4f69".to_string(),
                background: "#eff1f5".to_string(),
                cursor: "#dc8a78".to_string(),
                selection_bg: "#acb0be".to_string(),
                selection_fg: "#4c4f69".to_string(),
                // ANSI colors
                black: "#5c5f77".to_string(),
                red: "#d20f39".to_string(),
                green: "#40a02b".to_string(),
                yellow: "#df8e1d".to_string(),
                blue: "#1e66f5".to_string(),
                magenta: "#ea76cb".to_string(),
                cyan: "#179299".to_string(),
                white: "#acb0be".to_string(),
                bright_black: "#6c6f85".to_string(),
                bright_red: "#d20f39".to_string(),
                bright_green: "#40a02b".to_string(),
                bright_yellow: "#df8e1d".to_string(),
                bright_blue: "#1e66f5".to_string(),
                bright_magenta: "#ea76cb".to_string(),
                bright_cyan: "#179299".to_string(),
                bright_white: "#bcc0cc".to_string(),
                // UI chrome
                tab_bar_bg: "#e6e9ef".to_string(),
                tab_active_bg: "#eff1f5".to_string(),
                tab_inactive_fg: "#8c8fa1".to_string(),
                border: "#ccd0da".to_string(),
                active_border: "#1e66f5".to_string(),
            },
        }
    }

    /// Returns the Kimbo Dark theme — a neutral black/gray default.
    pub fn kimbo_dark() -> Self {
        Self {
            name: "kimbo-dark".to_string(),
            version: "1.0.0".to_string(),
            author: "Kimbo".to_string(),
            colors: ThemeColors {
                foreground: "#d4d4d4".to_string(),
                background: "#1a1a1a".to_string(),
                cursor: "#e0e0e0".to_string(),
                selection_bg: "#404040".to_string(),
                selection_fg: "#e0e0e0".to_string(),
                // ANSI colors
                black: "#3b3b3b".to_string(),
                red: "#f44747".to_string(),
                green: "#6a9955".to_string(),
                yellow: "#d7ba7d".to_string(),
                blue: "#569cd6".to_string(),
                magenta: "#c586c0".to_string(),
                cyan: "#4ec9b0".to_string(),
                white: "#d4d4d4".to_string(),
                bright_black: "#808080".to_string(),
                bright_red: "#f44747".to_string(),
                bright_green: "#6a9955".to_string(),
                bright_yellow: "#d7ba7d".to_string(),
                bright_blue: "#569cd6".to_string(),
                bright_magenta: "#c586c0".to_string(),
                bright_cyan: "#4ec9b0".to_string(),
                bright_white: "#e0e0e0".to_string(),
                // UI chrome
                tab_bar_bg: "#141414".to_string(),
                tab_active_bg: "#1a1a1a".to_string(),
                tab_inactive_fg: "#6e6e6e".to_string(),
                border: "#2e2e2e".to_string(),
                active_border: "#569cd6".to_string(),
            },
        }
    }

    /// Returns all built-in themes.
    pub fn builtin_themes() -> Vec<Theme> {
        vec![Self::kimbo_dark(), Self::catppuccin_mocha(), Self::catppuccin_latte()]
    }

    /// Loads a theme by name. Checks in order:
    /// 1. User themes directory (`~/.config/kimbo/themes/<name>.toml`)
    /// 2. Built-in themes
    /// 3. Community repo (auto-downloads and installs)
    pub fn load_by_name(name: &str) -> Option<Theme> {
        // Try user themes directory first.
        if let Some(theme) = Self::load_from_user_dir(name) {
            return Some(theme);
        }
        // Fall back to built-in themes.
        if let Some(theme) = Self::builtin_themes().into_iter().find(|t| t.name == name) {
            return Some(theme);
        }
        // Try downloading from community repo.
        log::info!("theme '{}' not found locally, trying community repo...", name);
        match Self::install_from_repo(name) {
            Ok(theme) => {
                log::info!("installed theme '{}' from community repo", name);
                Some(theme)
            }
            Err(e) => {
                log::warn!("could not download theme '{}': {}", name, e);
                None
            }
        }
    }

    /// Loads a theme from `~/.config/kimbo/themes/<name>.toml`.
    fn load_from_user_dir(name: &str) -> Option<Theme> {
        let dir = dirs::config_dir()?.join("kimbo").join("themes");
        let path = dir.join(format!("{name}.toml"));
        let content = std::fs::read_to_string(path).ok()?;
        toml::from_str(&content).ok()
    }

    /// Lists all available themes (built-in + user themes).
    pub fn all_available() -> Vec<Theme> {
        let mut themes = Self::builtin_themes();
        if let Some(user_themes) = Self::list_user_themes() {
            themes.extend(user_themes);
        }
        themes
    }

    /// The GitHub repo where community themes are hosted.
    const THEMES_REPO_URL: &'static str =
        "https://raw.githubusercontent.com/lucatescari/kimbo-themes/main/themes";

    /// GitHub API endpoint to list theme files in the repo.
    const THEMES_API_URL: &'static str =
        "https://api.github.com/repos/lucatescari/kimbo-themes/contents/themes";

    /// Fetches the list of available themes from the community GitHub repo.
    /// Returns theme names and whether each is already installed locally.
    pub fn list_remote_themes() -> anyhow::Result<Vec<RemoteThemeEntry>> {
        let body = ureq::get(Self::THEMES_API_URL)
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "kimbo-terminal")
            .call()?
            .body_mut()
            .read_to_string()?;

        // GitHub returns an array of objects, each with a "name" field.
        let entries: Vec<serde_json::Value> = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("failed to parse GitHub API response: {e}"))?;

        let local_themes: std::collections::HashSet<String> = Self::all_available()
            .into_iter()
            .map(|t| t.name)
            .collect();

        let mut themes = Vec::new();
        for entry in entries {
            if let Some(filename) = entry.get("name").and_then(|n| n.as_str()) {
                if let Some(name) = filename.strip_suffix(".toml") {
                    let installed = local_themes.contains(name);
                    // Download the theme file for preview rendering (skip already-installed ones).
                    let theme = if !installed {
                        Self::fetch_theme_content(name).ok()
                    } else {
                        None
                    };
                    themes.push(RemoteThemeEntry {
                        name: name.to_string(),
                        installed,
                        theme,
                    });
                }
            }
        }

        Ok(themes)
    }

    /// Fetches a theme file from the community repo without installing it.
    fn fetch_theme_content(name: &str) -> anyhow::Result<Theme> {
        let url = format!("{}/{name}.toml", Self::THEMES_REPO_URL);
        let body = ureq::get(&url).call()?.body_mut().read_to_string()?;
        let theme: Theme = toml::from_str(&body)
            .map_err(|e| anyhow::anyhow!("invalid theme file: {e}"))?;
        Ok(theme)
    }

    /// Downloads and installs a theme from the community repo.
    /// Fetches `<name>.toml` from GitHub and saves it to `~/.config/kimbo/themes/`.
    pub fn install_from_repo(name: &str) -> anyhow::Result<Theme> {
        let url = format!("{}/{name}.toml", Self::THEMES_REPO_URL);
        let body = ureq::get(&url).call()?.body_mut().read_to_string()?;

        // Parse to validate it's a real theme.
        let theme: Theme = toml::from_str(&body)
            .map_err(|e| anyhow::anyhow!("invalid theme file: {e}"))?;

        // Save to user themes directory.
        let dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("cannot find config directory"))?
            .join("kimbo")
            .join("themes");
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(format!("{name}.toml")), &body)?;

        Ok(theme)
    }

    /// Lists all themes in `~/.config/kimbo/themes/`.
    fn list_user_themes() -> Option<Vec<Theme>> {
        let dir = dirs::config_dir()?.join("kimbo").join("themes");
        let entries = std::fs::read_dir(dir).ok()?;
        let mut themes = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "toml") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(theme) = toml::from_str::<Theme>(&content) {
                        themes.push(theme);
                    }
                }
            }
        }
        Some(themes)
    }
}

// ---------------------------------------------------------------------------
// JSON-based theme types (VS Code-style, used by the Tauri frontend)
// ---------------------------------------------------------------------------

/// A VS Code-style JSON theme with a flat `colors` map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonTheme {
    pub name: String,
    #[serde(rename = "type")]
    pub theme_type: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    pub colors: HashMap<String, String>,
}

/// Resolved version of `JsonTheme` with every color mapped to a named field.
/// Serialized as JSON and sent to the Tauri frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonResolvedTheme {
    pub name: String,
    pub theme_type: String,
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_background: String,
    pub ansi_black: String,
    pub ansi_red: String,
    pub ansi_green: String,
    pub ansi_yellow: String,
    pub ansi_blue: String,
    pub ansi_magenta: String,
    pub ansi_cyan: String,
    pub ansi_white: String,
    pub ansi_bright_black: String,
    pub ansi_bright_red: String,
    pub ansi_bright_green: String,
    pub ansi_bright_yellow: String,
    pub ansi_bright_blue: String,
    pub ansi_bright_magenta: String,
    pub ansi_bright_cyan: String,
    pub ansi_bright_white: String,
    pub tab_active_bg: String,
    pub tab_inactive_bg: String,
    pub tab_active_fg: String,
    pub tab_inactive_fg: String,
    pub titlebar_bg: String,
    pub border: String,
    pub active_border: String,
}

/// Names of the built-in JSON themes shipped in the binary (without `.json`).
pub const BUILTIN_JSON_NAMES: &[&str] = &["kimbo-dark", "kimbo-light"];

impl JsonTheme {
    /// Returns a color from the `colors` map, or `fallback` if the key is absent.
    fn color_or(&self, key: &str, fallback: &str) -> String {
        self.colors.get(key).cloned().unwrap_or_else(|| fallback.to_string())
    }

    /// Load and parse a JSON theme from a file path.
    pub fn load_from_file(path: &Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let theme: Self = serde_json::from_str(&content)?;
        Ok(theme)
    }

    /// Load a built-in theme by name (e.g. "kimbo-dark").
    pub fn builtin(name: &str) -> Option<Self> {
        let json_str = match name {
            "kimbo-dark" => include_str!("themes/kimbo-dark.json"),
            "kimbo-light" => include_str!("themes/kimbo-light.json"),
            _ => return None,
        };
        serde_json::from_str(json_str).ok()
    }

    /// Load a theme by name. Checks user themes dir first
    /// (`~/.config/kimbo/themes/<name>.json`), then falls back to built-ins.
    pub fn load_by_name(name: &str) -> Option<Self> {
        // Try user themes directory first.
        if let Some(dir) = dirs::config_dir() {
            let path = dir.join("kimbo").join("themes").join(format!("{name}.json"));
            if path.exists() {
                if let Ok(theme) = Self::load_from_file(&path) {
                    return Some(theme);
                }
            }
        }
        // Fall back to built-in themes.
        Self::builtin(name)
    }

    /// List all available JSON theme names (built-in + user directory scan).
    pub fn list_available() -> Vec<String> {
        let mut names: Vec<String> = BUILTIN_JSON_NAMES.iter().map(|s| s.to_string()).collect();

        // Scan user themes directory for .json files.
        if let Some(dir) = dirs::config_dir() {
            let themes_dir = dir.join("kimbo").join("themes");
            if let Ok(entries) = std::fs::read_dir(themes_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().is_some_and(|e| e == "json") {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            let name = stem.to_string();
                            if !names.contains(&name) {
                                names.push(name);
                            }
                        }
                    }
                }
            }
        }

        names
    }

    /// Map the VS Code-style color keys to the flat `JsonResolvedTheme` struct.
    pub fn resolve(&self) -> JsonResolvedTheme {
        JsonResolvedTheme {
            name: self.name.clone(),
            theme_type: self.theme_type.clone(),
            background: self.color_or("terminal.background", "#000000"),
            foreground: self.color_or("terminal.foreground", "#ffffff"),
            cursor: self.color_or("terminal.cursor", "#ffffff"),
            selection_background: self.color_or("terminal.selectionBackground", "#444444"),
            ansi_black: self.color_or("terminal.ansiBlack", "#000000"),
            ansi_red: self.color_or("terminal.ansiRed", "#cc0000"),
            ansi_green: self.color_or("terminal.ansiGreen", "#00cc00"),
            ansi_yellow: self.color_or("terminal.ansiYellow", "#cccc00"),
            ansi_blue: self.color_or("terminal.ansiBlue", "#0000cc"),
            ansi_magenta: self.color_or("terminal.ansiMagenta", "#cc00cc"),
            ansi_cyan: self.color_or("terminal.ansiCyan", "#00cccc"),
            ansi_white: self.color_or("terminal.ansiWhite", "#cccccc"),
            ansi_bright_black: self.color_or("terminal.ansiBrightBlack", "#555555"),
            ansi_bright_red: self.color_or("terminal.ansiBrightRed", "#ff0000"),
            ansi_bright_green: self.color_or("terminal.ansiBrightGreen", "#00ff00"),
            ansi_bright_yellow: self.color_or("terminal.ansiBrightYellow", "#ffff00"),
            ansi_bright_blue: self.color_or("terminal.ansiBrightBlue", "#0000ff"),
            ansi_bright_magenta: self.color_or("terminal.ansiBrightMagenta", "#ff00ff"),
            ansi_bright_cyan: self.color_or("terminal.ansiBrightCyan", "#00ffff"),
            ansi_bright_white: self.color_or("terminal.ansiBrightWhite", "#ffffff"),
            tab_active_bg: self.color_or("tab.activeBackground", "#333333"),
            tab_inactive_bg: self.color_or("tab.inactiveBackground", "#1a1a1a"),
            tab_active_fg: self.color_or("tab.activeForeground", "#ffffff"),
            tab_inactive_fg: self.color_or("tab.inactiveForeground", "#888888"),
            titlebar_bg: self.color_or("titleBar.background", "#1a1a1a"),
            border: self.color_or("panel.border", "#333333"),
            active_border: self.color_or("panel.activeBorder", "#0066ff"),
        }
    }
}

// ---------------------------------------------------------------------------
// Unified theme types (shared across the Tauri IPC boundary).
// ---------------------------------------------------------------------------

/// Source of a theme listed in the unified themes view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeSource {
    /// Shipped in the binary (see `BUILTIN_JSON_NAMES`).
    Builtin,
    /// Present on disk at `~/.config/kimbo/themes/<slug>.json` (not builtin).
    Installed,
    /// Listed in the community `index.json` but not locally installed.
    Available,
}

/// Four preview colors used by the settings card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSwatches {
    pub background: String,
    pub foreground: String,
    pub accent: String,
    pub cursor: String,
}

/// Unified theme entry returned by `list_unified_themes` and
/// `themes://community-ready` event payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedTheme {
    pub slug: String,
    pub name: String,
    pub theme_type: String,
    pub author: String,
    pub version: String,
    pub swatches: ThemeSwatches,
    pub source: ThemeSource,
    pub active: bool,
}

impl JsonTheme {
    /// Extract the four swatch preview colors from this theme's `colors` map.
    /// Missing keys fall back to the same defaults used by `resolve()`.
    pub fn swatches(&self) -> ThemeSwatches {
        ThemeSwatches {
            background: self.color_or("terminal.background", "#000000"),
            foreground: self.color_or("terminal.foreground", "#ffffff"),
            accent: self.color_or("terminal.ansiBlue", "#0000ff"),
            cursor: self.color_or("terminal.cursor", "#ffffff"),
        }
    }
}

/// Classify a theme slug given the list of slugs present in the user's
/// themes directory. Precedence: Builtin > Installed > Available.
pub fn classify_slug(slug: &str, installed_slugs: &[String]) -> ThemeSource {
    if BUILTIN_JSON_NAMES.iter().any(|b| *b == slug) {
        ThemeSource::Builtin
    } else if installed_slugs.iter().any(|s| s == slug) {
        ThemeSource::Installed
    } else {
        ThemeSource::Available
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hex() {
        assert_eq!(parse_hex("#ff0000"), Some((255, 0, 0)));
        assert_eq!(parse_hex("00ff00"), Some((0, 255, 0)));
        assert_eq!(parse_hex("#1e1e2e"), Some((30, 30, 46)));
        assert_eq!(parse_hex("#000000"), Some((0, 0, 0)));
        assert_eq!(parse_hex("#ffffff"), Some((255, 255, 255)));
    }

    #[test]
    fn test_parse_hex_invalid() {
        assert_eq!(parse_hex(""), None);
        assert_eq!(parse_hex("#fff"), None);
        assert_eq!(parse_hex("zzzzzz"), None);
        assert_eq!(parse_hex("#gggggg"), None);
        assert_eq!(parse_hex("#12345"), None);
    }

    #[test]
    fn test_builtin_themes_exist() {
        let themes = Theme::builtin_themes();
        assert_eq!(themes.len(), 3);
        let names: Vec<&str> = themes.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"kimbo-dark"));
        assert!(names.contains(&"catppuccin-mocha"));
        assert!(names.contains(&"catppuccin-latte"));
    }

    #[test]
    fn test_load_by_name() {
        let mocha = Theme::load_by_name("catppuccin-mocha");
        assert!(mocha.is_some());
        let mocha = mocha.unwrap();
        assert_eq!(mocha.colors.background, "#1e1e2e");

        let latte = Theme::load_by_name("catppuccin-latte");
        assert!(latte.is_some());
        let latte = latte.unwrap();
        assert_eq!(latte.colors.background, "#eff1f5");

        assert!(Theme::load_by_name("nonexistent-theme").is_none());
    }

    #[test]
    fn test_resolve_theme() {
        let theme = Theme::catppuccin_mocha();
        let resolved = theme.resolve();
        assert_eq!(resolved.name, "catppuccin-mocha");
        assert_eq!(resolved.background, (30, 30, 46));
        assert_eq!(resolved.foreground, (205, 214, 244));
        assert_eq!(resolved.red, (243, 139, 168));
        assert_eq!(resolved.tab_bar_bg, (24, 24, 37));
        // Surface should be derived (slightly lighter for dark theme).
        assert!(resolved.surface.0 > resolved.background.0);
    }

    #[test]
    fn test_resolve_light_theme() {
        let theme = Theme::catppuccin_latte();
        let resolved = theme.resolve();
        assert_eq!(resolved.name, "catppuccin-latte");
        assert_eq!(resolved.background, (239, 241, 245));
        // Surface should be derived (slightly darker for light theme).
        assert!(resolved.surface.0 < resolved.background.0);
    }

    #[test]
    fn test_resolved_to_rgb() {
        assert_eq!(ResolvedTheme::to_rgb((0x1e, 0x1e, 0x2e)), 0x1e1e2e);
        assert_eq!(ResolvedTheme::to_rgb((255, 0, 0)), 0xff0000);
        assert_eq!(ResolvedTheme::to_rgb((0, 255, 0)), 0x00ff00);
    }

    #[test]
    fn test_theme_serialize_roundtrip() {
        let theme = Theme::catppuccin_mocha();
        let json = serde_json::to_string(&theme).unwrap();
        let parsed: Theme = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, theme.name);
        assert_eq!(parsed.colors.foreground, theme.colors.foreground);
        assert_eq!(parsed.colors.background, theme.colors.background);
        assert_eq!(parsed.colors.red, theme.colors.red);
        assert_eq!(parsed.colors.tab_bar_bg, theme.colors.tab_bar_bg);
    }
}

#[cfg(test)]
mod json_tests {
    use super::*;

    #[test]
    fn test_parse_json_theme() {
        let json = r##"{ "name": "Test", "type": "dark", "colors": { "terminal.background": "#0a0a1a", "terminal.foreground": "#e0e0e0" } }"##;
        let theme: JsonTheme = serde_json::from_str(json).unwrap();
        assert_eq!(theme.name, "Test");
        let resolved = theme.resolve();
        assert_eq!(resolved.background, "#0a0a1a");
        assert_eq!(resolved.foreground, "#e0e0e0");
    }

    #[test]
    fn test_builtin_kimbo_dark() {
        let theme = JsonTheme::builtin("kimbo-dark").expect("builtin should exist");
        assert_eq!(theme.name, "Kimbo Dark");
        assert_eq!(theme.author, "lucatescari");
        assert_eq!(theme.version, "1.0.0");
        let resolved = theme.resolve();
        assert_eq!(resolved.background, "#1a1a1a");
    }

    #[test]
    fn test_builtin_kimbo_light() {
        let theme = JsonTheme::builtin("kimbo-light").expect("builtin should exist");
        assert_eq!(theme.name, "Kimbo Light");
        assert_eq!(theme.theme_type, "light");
        assert_eq!(theme.author, "lucatescari");
        let resolved = theme.resolve();
        assert_eq!(resolved.background, "#f5f2eb");
    }

    #[test]
    fn test_catppuccin_not_builtin_anymore() {
        assert!(JsonTheme::builtin("catppuccin-mocha").is_none());
        assert!(JsonTheme::builtin("catppuccin-latte").is_none());
    }

    #[test]
    fn test_list_available_contains_only_kimbo_builtins() {
        let names = JsonTheme::list_available();
        assert!(names.contains(&"kimbo-dark".to_string()));
        assert!(names.contains(&"kimbo-light".to_string()));
        // Catppuccin themes are no longer built-in. (They may still appear
        // if the user has installed them locally; the test environment's
        // user themes directory is effectively empty.)
    }

    #[test]
    fn test_json_theme_author_and_version_parse() {
        let json = r##"{
            "name": "Test",
            "type": "dark",
            "author": "someuser",
            "version": "2.0.0",
            "colors": { "terminal.background": "#000000" }
        }"##;
        let theme: JsonTheme = serde_json::from_str(json).unwrap();
        assert_eq!(theme.author, "someuser");
        assert_eq!(theme.version, "2.0.0");
    }

    #[test]
    fn test_json_theme_author_and_version_default_when_missing() {
        let json = r##"{
            "name": "Test",
            "type": "dark",
            "colors": { "terminal.background": "#000000" }
        }"##;
        let theme: JsonTheme = serde_json::from_str(json).unwrap();
        assert_eq!(theme.author, "");
        assert_eq!(theme.version, "");
    }

    #[test]
    fn test_extract_swatches_pulls_the_four_preview_colors() {
        let theme = JsonTheme::builtin("kimbo-dark").unwrap();
        let s = theme.swatches();
        assert_eq!(s.background, "#1a1a1a");
        assert_eq!(s.foreground, "#d4d4d4");
        // Accent is ANSI blue for the unified card preview.
        assert_eq!(s.accent, "#569cd6");
        assert_eq!(s.cursor, "#e0e0e0");
    }

    #[test]
    fn test_classify_slug_builtin_wins() {
        // kimbo-dark is in BUILTIN_JSON_NAMES, so classification is Builtin
        // even if a file exists in the user's themes dir (not tested here
        // directly — validated in command-layer tests).
        assert_eq!(classify_slug("kimbo-dark", &["kimbo-dark".to_string()]), ThemeSource::Builtin);
        assert_eq!(classify_slug("kimbo-light", &[]), ThemeSource::Builtin);
    }

    #[test]
    fn test_classify_slug_installed_when_on_disk() {
        let installed = vec!["catppuccin-mocha".to_string()];
        assert_eq!(classify_slug("catppuccin-mocha", &installed), ThemeSource::Installed);
    }

    #[test]
    fn test_classify_slug_available_when_neither() {
        let installed: Vec<String> = vec![];
        assert_eq!(classify_slug("some-cool-theme", &installed), ThemeSource::Available);
    }
}
