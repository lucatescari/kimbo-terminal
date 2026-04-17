use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// The type of project detected based on marker files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectType {
    Rust,
    Node,
    Python,
    Go,
    Git,
    Generic,
}

/// A detected project directory with metadata.
#[derive(Debug, Clone)]
pub struct DetectedProject {
    pub name: String,
    pub path: PathBuf,
    pub project_type: ProjectType,
    pub last_modified: SystemTime,
}

/// Marker files mapped to their project types, checked in priority order.
const MARKERS: &[(&str, ProjectType)] = &[
    ("Cargo.toml", ProjectType::Rust),
    ("package.json", ProjectType::Node),
    ("pyproject.toml", ProjectType::Python),
    ("go.mod", ProjectType::Go),
    (".git", ProjectType::Git),
    (".project-root", ProjectType::Generic),
];

/// Check if a directory is a project by looking for known marker files.
///
/// Returns `Some(DetectedProject)` if any marker is found, using the highest
/// priority match. Returns `None` for non-project directories.
pub fn detect_project(path: &Path) -> Option<DetectedProject> {
    if !path.is_dir() {
        return None;
    }

    for (marker, project_type) in MARKERS {
        if path.join(marker).exists() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let last_modified = fs::metadata(path)
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            return Some(DetectedProject {
                name,
                path: path.to_path_buf(),
                project_type: project_type.clone(),
                last_modified,
            });
        }
    }

    None
}

/// Recursively scan a base directory for projects up to `max_depth` levels deep.
///
/// Skips hidden directories (starting with `.`). Results are sorted by
/// last_modified in descending order (most recent first).
pub fn scan_directory(base: &Path, max_depth: usize) -> Vec<DetectedProject> {
    let mut results = Vec::new();
    scan_recursive(base, max_depth, 0, &mut results);
    results.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    results
}

fn scan_recursive(dir: &Path, max_depth: usize, current_depth: usize, results: &mut Vec<DetectedProject>) {
    if current_depth > max_depth {
        return;
    }

    if !dir.is_dir() {
        return;
    }

    // If this directory is itself a project, add it and don't recurse deeper.
    if let Some(project) = detect_project(dir) {
        results.push(project);
        return;
    }

    // Otherwise, scan children.
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip hidden directories.
        if let Some(name) = path.file_name() {
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
        }

        scan_recursive(&path, max_depth, current_depth + 1, results);
    }
}

/// Expand a leading `~` in a path string to the user's home directory.
pub fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    } else if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_detect_rust_project() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();

        let project = detect_project(dir.path()).expect("should detect Rust project");
        assert_eq!(project.project_type, ProjectType::Rust);
        assert_eq!(project.path, dir.path());
    }

    #[test]
    fn test_detect_node_project() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("package.json"), "{}").unwrap();

        let project = detect_project(dir.path()).expect("should detect Node project");
        assert_eq!(project.project_type, ProjectType::Node);
    }

    #[test]
    fn test_detect_non_project_returns_none() {
        let dir = TempDir::new().unwrap();
        // Empty directory — no markers.
        assert!(detect_project(dir.path()).is_none());
    }

    #[test]
    fn test_scan_directory() {
        let base = TempDir::new().unwrap();

        // Create two project directories inside the base.
        let rust_dir = base.path().join("my-rust");
        fs::create_dir(&rust_dir).unwrap();
        fs::write(rust_dir.join("Cargo.toml"), "[package]").unwrap();

        let node_dir = base.path().join("my-node");
        fs::create_dir(&node_dir).unwrap();
        fs::write(node_dir.join("package.json"), "{}").unwrap();

        let projects = scan_directory(base.path(), 2);
        assert_eq!(projects.len(), 2);

        let types: Vec<&ProjectType> = projects.iter().map(|p| &p.project_type).collect();
        assert!(types.contains(&&ProjectType::Rust));
        assert!(types.contains(&&ProjectType::Node));
    }

    #[test]
    fn test_scan_skips_hidden_dirs() {
        let base = TempDir::new().unwrap();

        // Create a hidden directory that is a project — should be skipped.
        let hidden = base.path().join(".hidden-project");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("Cargo.toml"), "[package]").unwrap();

        // Create a visible project.
        let visible = base.path().join("visible");
        fs::create_dir(&visible).unwrap();
        fs::write(visible.join("package.json"), "{}").unwrap();

        let projects = scan_directory(base.path(), 2);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_type, ProjectType::Node);
    }

    #[test]
    fn test_expand_tilde() {
        let expanded = expand_tilde("~/Projects");
        if let Some(home) = dirs::home_dir() {
            assert_eq!(expanded, home.join("Projects"));
        }

        // Non-tilde path should be returned as-is.
        let plain = expand_tilde("/usr/local/bin");
        assert_eq!(plain, PathBuf::from("/usr/local/bin"));
    }

    #[test]
    fn test_expand_tilde_bare() {
        let expanded = expand_tilde("~");
        if let Some(home) = dirs::home_dir() {
            assert_eq!(expanded, home);
        }
    }
}
