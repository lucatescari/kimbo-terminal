//! Pre-build script: stages freshly built sidecar binaries at
//! `src-tauri/binaries/<name>-<target-triple>` so Tauri picks them up as
//! `externalBin` (signed + timestamped during macOS notarization, which
//! `bundle.resources` is NOT).
//!
//! Re-runs only when a sidecar's source changes.
//!
//! Also stamps `KIMBO_BUILD_ID` — the git commit this binary was compiled
//! from — so a running app can say exactly which source it came from and a
//! stable release can be proven to be the same code as the unstable build
//! that previewed it. See docs/release-identity.md.

use std::path::{Path, PathBuf};
use std::process::Command;

const SIDECARS: &[&str] = &["kimbo-claude-statusline", "kimbo-claude-notify"];

/// Short git SHA of the commit being built, with a `-dirty` suffix when the
/// working tree has uncommitted changes.
///
/// `scripts/release.sh` passes `KIMBO_BUILD_ID` explicitly. It has to: the
/// unstable channel edits the version files in place before building and
/// restores them afterwards, so a tree this script inspected mid-build would
/// always look dirty. Letting the release script pin the value also
/// guarantees the id inside the binary and the one written to latest.json
/// are the same string by construction rather than by coincidence.
fn build_id(workspace_root: &Path) -> String {
    if let Ok(pinned) = std::env::var("KIMBO_BUILD_ID") {
        let pinned = pinned.trim().to_string();
        if !pinned.is_empty() {
            return pinned;
        }
    }

    let git = |args: &[&str]| -> Option<String> {
        let out = Command::new("git")
            .current_dir(workspace_root)
            .args(args)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    };

    // A source tarball or vendored build has no git metadata. That is not an
    // error — it just cannot be traced back to a commit.
    let Some(sha) = git(&["rev-parse", "--short=7", "HEAD"]).filter(|s| !s.is_empty()) else {
        return "unknown".to_string();
    };

    match git(&["status", "--porcelain"]) {
        Some(status) if !status.is_empty() => format!("{sha}-dirty"),
        _ => sha,
    }
}

fn main() {
    for name in SIDECARS {
        println!("cargo:rerun-if-changed=../crates/{name}/src");
        println!("cargo:rerun-if-changed=../crates/{name}/Cargo.toml");
    }

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let target = std::env::var("TARGET").expect("TARGET env var set by cargo");
    let manifest_dir: PathBuf = std::env::var("CARGO_MANIFEST_DIR").unwrap().into();
    let workspace_root = manifest_dir.parent().unwrap();

    // Without these the stamp would go stale: an incremental build that only
    // moved HEAD would keep the previously baked-in id.
    println!("cargo:rerun-if-env-changed=KIMBO_BUILD_ID");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    println!(
        "cargo:rustc-env=KIMBO_BUILD_ID={}",
        build_id(workspace_root)
    );
    let target_dir = workspace_root.join("target");
    let dst_dir = manifest_dir.join("binaries");
    std::fs::create_dir_all(&dst_dir).expect("create binaries dir");

    for name in SIDECARS {
        let bin_name = if cfg!(windows) {
            format!("{name}.exe")
        } else {
            (*name).to_string()
        };
        let candidates = [
            target_dir.join(&target).join(&profile).join(&bin_name),
            target_dir.join(&profile).join(&bin_name),
        ];
        let src = candidates.iter().find(|p| p.exists());

        let dst_name = if cfg!(windows) {
            format!("{name}-{target}.exe")
        } else {
            format!("{name}-{target}")
        };
        let dst = dst_dir.join(&dst_name);

        match src {
            None => {
                println!(
                    "cargo:warning=sidecar binary {name} not found in target/; run `cargo build --release -p {name}` first"
                );
            }
            Some(src) => {
                std::fs::copy(src, &dst).expect("copy sidecar into binaries");
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mut perms = std::fs::metadata(&dst).unwrap().permissions();
                    perms.set_mode(0o755);
                    std::fs::set_permissions(&dst, perms).unwrap();
                }
            }
        }
    }

    tauri_build::build();
}
