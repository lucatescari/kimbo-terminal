use kimbo_workspace::detector::expand_tilde;
use std::path::PathBuf;

/// Folders in the home directory where a file named without its folder is
/// looked for after the working directory, in this order. These are where a
/// tool drops a file "for you" and then mentions it by name alone.
const USER_SEARCH_DIRS: [&str; 3] = ["Downloads", "Desktop", "Documents"];

/// Resolve a raw path token (as detected in terminal output) to an absolute,
/// existing path. Returns `None` when the path does not exist — the frontend
/// uses that to decide whether a token becomes a clickable link.
///
/// - `~` / `~/…` expands to the home directory.
/// - A relative path is joined against `cwd` (the shell's working directory,
///   tracked via OSC 7) when one is supplied.
/// - With `search_user_dirs`, a filename with no folder that is not in `cwd`
///   is also looked for in the home directory's Downloads, Desktop and
///   Documents folders. The working directory always wins.
/// - The result is canonicalized; since `canonicalize` errors on a missing
///   path, a returned `Some` implies the path exists.
///
/// `(async)` matters: the link provider asks about every path-like token on a
/// hovered row, and a row inside an indented block can raise that into the
/// dozens on a first hover. A plain sync command would run every one of those
/// `canonicalize` syscalls on the macOS UI thread.
#[tauri::command(async)]
pub fn resolve_existing_path(
    raw: String,
    cwd: Option<String>,
    search_user_dirs: Option<bool>,
) -> Option<String> {
    let search_dirs: Vec<PathBuf> = if search_user_dirs.unwrap_or(false) {
        dirs::home_dir()
            .map(|home| USER_SEARCH_DIRS.iter().map(|d| home.join(d)).collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    resolve_in(&raw, cwd.as_deref(), &search_dirs)
}

/// The resolution itself, with the fallback folders passed in so tests can
/// point them at temp dirs instead of the real home directory.
fn resolve_in(raw: &str, cwd: Option<&str>, search_dirs: &[PathBuf]) -> Option<String> {
    let expanded = expand_tilde(raw);
    let found = |p: PathBuf| {
        p.canonicalize()
            .ok()
            .map(|r| r.to_string_lossy().into_owned())
    };

    if expanded.is_absolute() {
        return found(expanded);
    }

    let in_cwd = match cwd.filter(|c| !c.is_empty()) {
        Some(cwd) => PathBuf::from(cwd).join(&expanded),
        None => expanded.clone(),
    };
    if let Some(hit) = found(in_cwd) {
        return Some(hit);
    }

    // Only a name with no folder falls back. "sub/b.txt" says where it is
    // relative to something, and guessing that something would link files
    // the text never meant.
    if expanded.components().count() != 1 {
        return None;
    }
    search_dirs
        .iter()
        .find_map(|dir| found(dir.join(&expanded)))
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
        let got = resolve_existing_path(file.to_string_lossy().into_owned(), None, None);
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
            None,
        );
        assert!(got.is_some());
        assert!(got.unwrap().ends_with("b.txt"));
    }

    #[test]
    fn returns_none_for_a_missing_absolute_path() {
        assert_eq!(
            resolve_existing_path("/no/such/path/xyzzy".to_string(), None, None),
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
                None,
            ),
            None
        );
    }

    fn s(p: &std::path::Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn bare_name_falls_back_to_a_search_dir_when_cwd_has_no_such_file() {
        let cwd = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();
        fs::write(downloads.path().join("shot.png"), "x").unwrap();

        let got = resolve_in(
            "shot.png",
            Some(&s(cwd.path())),
            &[downloads.path().to_path_buf()],
        );

        let expected = downloads.path().join("shot.png").canonicalize().unwrap();
        assert_eq!(got, Some(s(&expected)));
    }

    #[test]
    fn cwd_wins_over_a_search_dir_holding_the_same_name() {
        let cwd = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();
        fs::write(cwd.path().join("shot.png"), "x").unwrap();
        fs::write(downloads.path().join("shot.png"), "x").unwrap();

        let got = resolve_in(
            "shot.png",
            Some(&s(cwd.path())),
            &[downloads.path().to_path_buf()],
        );

        let expected = cwd.path().join("shot.png").canonicalize().unwrap();
        assert_eq!(got, Some(s(&expected)));
    }

    #[test]
    fn search_dirs_are_tried_in_order() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        fs::write(first.path().join("a.txt"), "x").unwrap();
        fs::write(second.path().join("a.txt"), "x").unwrap();

        let got = resolve_in(
            "a.txt",
            None,
            &[first.path().to_path_buf(), second.path().to_path_buf()],
        );

        let expected = first.path().join("a.txt").canonicalize().unwrap();
        assert_eq!(got, Some(s(&expected)));
    }

    #[test]
    fn a_relative_path_with_a_slash_never_uses_the_search_dirs() {
        let cwd = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();
        fs::create_dir(downloads.path().join("sub")).unwrap();
        fs::write(downloads.path().join("sub").join("b.txt"), "x").unwrap();

        let got = resolve_in(
            "sub/b.txt",
            Some(&s(cwd.path())),
            &[downloads.path().to_path_buf()],
        );

        assert_eq!(got, None);
    }

    #[test]
    fn a_bare_name_found_nowhere_resolves_to_none() {
        let cwd = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();

        let got = resolve_in(
            "nope.png",
            Some(&s(cwd.path())),
            &[downloads.path().to_path_buf()],
        );

        assert_eq!(got, None);
    }
}
