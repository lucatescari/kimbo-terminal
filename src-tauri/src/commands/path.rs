use kimbo_workspace::detector::expand_tilde;
use std::path::PathBuf;

/// Resolve a raw path token (as detected in terminal output) to an absolute,
/// existing path. Returns `None` when the path does not exist — the frontend
/// uses that to decide whether a token becomes a clickable link.
///
/// - `~` / `~/…` expands to the home directory.
/// - A relative path is joined against `cwd` (the shell's working directory,
///   tracked via OSC 7) when one is supplied.
/// - The result is canonicalized; since `canonicalize` errors on a missing
///   path, a returned `Some` implies the path exists.
#[tauri::command]
pub fn resolve_existing_path(raw: String, cwd: Option<String>) -> Option<String> {
    let expanded = expand_tilde(&raw);

    let candidate: PathBuf = if expanded.is_absolute() {
        expanded
    } else if let Some(cwd) = cwd.filter(|c| !c.is_empty()) {
        PathBuf::from(cwd).join(expanded)
    } else {
        expanded
    };

    let resolved = candidate.canonicalize().ok()?;
    Some(resolved.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_an_existing_absolute_path() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "x").unwrap();
        let got = resolve_existing_path(file.to_string_lossy().into_owned(), None);
        assert!(got.is_some());
        assert!(got.unwrap().ends_with("a.txt"));
    }

    #[test]
    fn resolves_a_relative_path_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let file = dir.path().join("sub").join("b.txt");
        fs::write(&file, "x").unwrap();
        let got = resolve_existing_path(
            "sub/b.txt".to_string(),
            Some(dir.path().to_string_lossy().into_owned()),
        );
        assert!(got.is_some());
        assert!(got.unwrap().ends_with("b.txt"));
    }

    #[test]
    fn returns_none_for_a_missing_absolute_path() {
        assert_eq!(
            resolve_existing_path("/no/such/path/xyzzy".to_string(), None),
            None
        );
    }

    #[test]
    fn returns_none_for_a_missing_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_existing_path(
                "nope.txt".to_string(),
                Some(dir.path().to_string_lossy().into_owned()),
            ),
            None
        );
    }
}
