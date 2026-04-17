use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Metadata about a workspace (name, path, layout preset).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceMeta {
    pub name: String,
    pub path: String,
    pub layout: String,
}

/// Configuration for a single pane in a workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaneConfig {
    pub command: Option<String>,
}

/// A full workspace profile that can be saved and restored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceProfile {
    pub workspace: WorkspaceMeta,
    pub panes: Vec<PaneConfig>,
}

impl WorkspaceProfile {
    /// Return the directory where profiles are stored.
    ///
    /// Defaults to `~/.config/kimbo/profiles/`.
    pub fn profiles_dir() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("kimbo")
            .join("profiles")
    }

    /// Load a profile by name from the profiles directory.
    pub fn load(name: &str) -> Result<Self> {
        let path = Self::profiles_dir().join(format!("{}.toml", name));
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read profile: {}", path.display()))?;
        let profile: WorkspaceProfile =
            toml::from_str(&content).with_context(|| "failed to parse profile TOML")?;
        Ok(profile)
    }

    /// Save this profile to the profiles directory using the workspace name.
    pub fn save(&self) -> Result<()> {
        let dir = Self::profiles_dir();
        fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create profiles dir: {}", dir.display()))?;

        let path = dir.join(format!("{}.toml", self.workspace.name));
        let content =
            toml::to_string_pretty(self).with_context(|| "failed to serialize profile")?;
        fs::write(&path, content)
            .with_context(|| format!("failed to write profile: {}", path.display()))?;
        Ok(())
    }

    /// List all saved profile names (without the `.toml` extension).
    pub fn list_profiles() -> Result<Vec<String>> {
        let dir = Self::profiles_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut names = Vec::new();
        for entry in fs::read_dir(&dir)
            .with_context(|| format!("failed to read profiles dir: {}", dir.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "toml") {
                if let Some(stem) = path.file_stem() {
                    names.push(stem.to_string_lossy().to_string());
                }
            }
        }
        names.sort();
        Ok(names)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profile_serialize() {
        let profile = WorkspaceProfile {
            workspace: WorkspaceMeta {
                name: "my-project".to_string(),
                path: "/home/user/projects/my-project".to_string(),
                layout: "default".to_string(),
            },
            panes: vec![
                PaneConfig {
                    command: Some("cargo watch".to_string()),
                },
                PaneConfig { command: None },
            ],
        };

        // Serialize to TOML string.
        let toml_str = toml::to_string_pretty(&profile).expect("serialize failed");

        // Deserialize back.
        let restored: WorkspaceProfile =
            toml::from_str(&toml_str).expect("deserialize failed");

        assert_eq!(profile, restored);
    }
}
