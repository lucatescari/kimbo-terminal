//! Pre-build script: stages the freshly built `kimbo-claude-statusline`
//! binary at `src-tauri/binaries/kimbo-claude-statusline-<target-triple>`
//! so Tauri picks it up as an `externalBin` (signed + timestamped during
//! macOS notarization, which `bundle.resources` is NOT).
//!
//! Re-runs only when the sidecar source changes.

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=../crates/kimbo-claude-statusline/src");
    println!("cargo:rerun-if-changed=../crates/kimbo-claude-statusline/Cargo.toml");

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let target = std::env::var("TARGET").expect("TARGET env var set by cargo");
    let manifest_dir: PathBuf = std::env::var("CARGO_MANIFEST_DIR").unwrap().into();
    let workspace_root = manifest_dir.parent().unwrap();
    let target_dir = workspace_root.join("target");

    let bin_name = if cfg!(windows) {
        "kimbo-claude-statusline.exe"
    } else {
        "kimbo-claude-statusline"
    };

    // When cargo builds with --target, artifacts land under target/<triple>/<profile>.
    // Without --target they land under target/<profile>. Try both.
    let candidates = [
        target_dir.join(&target).join(&profile).join(bin_name),
        target_dir.join(&profile).join(bin_name),
    ];
    let src = candidates.iter().find(|p| p.exists());

    let dst_dir = manifest_dir.join("binaries");
    // Tauri externalBin convention: filename suffixed with the target triple;
    // bundler strips the suffix when copying into Contents/MacOS/.
    let dst_name = if cfg!(windows) {
        format!("kimbo-claude-statusline-{target}.exe")
    } else {
        format!("kimbo-claude-statusline-{target}")
    };
    let dst = dst_dir.join(&dst_name);

    std::fs::create_dir_all(&dst_dir).expect("create binaries dir");

    match src {
        None => {
            println!(
                "cargo:warning=sidecar binary not found in target/; run `cargo build --release -p kimbo-claude-statusline` first"
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

    tauri_build::build();
}
