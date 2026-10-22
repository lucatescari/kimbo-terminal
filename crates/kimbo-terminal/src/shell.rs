//! Which shell to start when nothing is configured.
//!
//! `$SHELL` is the user's answer when it is set. When it is not (a session
//! started from a desktop file, a container, a test runner), the account's
//! login shell from the password database is the next best thing. Only then
//! comes a fixed list, and `/bin/zsh` is not assumed to exist: it is the
//! macOS default but absent on most Linux images.

use std::ffi::CStr;
use std::path::Path;

/// The shell to run when none is configured: `$SHELL`, else the account's
/// login shell, else the first of a fixed list that exists.
pub fn login_shell() -> String {
    login_shell_from(std::env::var("SHELL").ok().as_deref())
}

fn login_shell_from(env_shell: Option<&str>) -> String {
    if let Some(s) = env_shell.map(str::trim).filter(|s| !s.is_empty()) {
        return s.to_string();
    }
    if let Some(pw) = passwd_shell().filter(|s| Path::new(s).exists()) {
        return pw;
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "/bin/sh".to_string()
}

/// The login shell recorded for the current user in the password database.
fn passwd_shell() -> Option<String> {
    // SAFETY: getpwuid returns a pointer to static storage (or null); we copy
    // the shell string out before any other call could overwrite it.
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() || (*pw).pw_shell.is_null() {
            return None;
        }
        let shell = CStr::from_ptr((*pw).pw_shell).to_string_lossy().into_owned();
        (!shell.is_empty()).then_some(shell)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_set_shell_variable_wins() {
        assert_eq!(login_shell_from(Some("/usr/local/bin/fish")), "/usr/local/bin/fish");
    }

    #[test]
    fn an_empty_shell_variable_is_treated_as_unset() {
        assert_eq!(login_shell_from(Some("")), login_shell_from(None));
    }

    #[test]
    fn without_the_variable_the_result_is_an_existing_executable() {
        let shell = login_shell_from(None);
        let meta = std::fs::metadata(&shell).expect("fallback shell must exist");
        use std::os::unix::fs::PermissionsExt;
        assert!(meta.is_file() && meta.permissions().mode() & 0o111 != 0, "{shell}");
    }

    #[test]
    fn without_the_variable_the_account_login_shell_is_preferred() {
        let pw = passwd_shell().expect("test runs as a real user");
        if std::path::Path::new(&pw).exists() {
            assert_eq!(login_shell_from(None), pw);
        }
    }
}
