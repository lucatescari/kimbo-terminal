use kimbo_config::AppConfig;
use kimbo_workspace::detector;
use serde::Serialize;

#[derive(Serialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub project_type: String,
}

#[tauri::command]
pub fn list_projects() -> Vec<ProjectInfo> {
    let config = AppConfig::load().unwrap_or_default();
    let mut projects = Vec::new();

    for scan_dir in &config.workspace.scan_dirs {
        let expanded = detector::expand_tilde(scan_dir);
        let found = detector::scan_directory(&expanded, 2);
        for p in found {
            projects.push(ProjectInfo {
                name: p.name,
                path: p.path.to_string_lossy().to_string(),
                project_type: format!("{:?}", p.project_type),
            });
        }
    }

    // Also scan common home-dir subdirectories when auto-detect is on.
    if config.workspace.auto_detect {
        let home = dirs::home_dir().unwrap_or_default();
        for subdir in &["src", "dev", "repos", "code"] {
            let dir = home.join(subdir);
            if dir.exists() {
                let found = detector::scan_directory(&dir, 2);
                for p in found {
                    if !projects
                        .iter()
                        .any(|e| e.path == p.path.to_string_lossy().as_ref())
                    {
                        projects.push(ProjectInfo {
                            name: p.name,
                            path: p.path.to_string_lossy().to_string(),
                            project_type: format!("{:?}", p.project_type),
                        });
                    }
                }
            }
        }
    }

    projects
}
