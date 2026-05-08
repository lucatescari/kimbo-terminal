//! Pre-build script: stages freshly built sidecar binaries at
//! `src-tauri/binaries/<name>-<target-triple>` so Tauri picks them up as
//! `externalBin` (signed + timestamped during macOS notarization, which
//! `bundle.resources` is NOT).
//!
//! Re-runs only when a sidecar's source changes.

use std::path::PathBuf;

const SIDECARS: &[&str] = &["kimbo-claude-statusline", "kimbo-claude-notify"];

fn main() {
    for name in SIDECARS {
        println!("cargo:rerun-if-changed=../crates/{name}/src");
        println!("cargo:rerun-if-changed=../crates/{name}/Cargo.toml");
    }

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let target = std::env::var("TARGET").expect("TARGET env var set by cargo");
    let manifest_dir: PathBuf = std::env::var("CARGO_MANIFEST_DIR").unwrap().into();
    let workspace_root = manifest_dir.parent().unwrap();
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
