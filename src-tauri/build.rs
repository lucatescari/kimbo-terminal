//! Pre-build script: copies the freshly built `kimbo-claude-statusline`
//! binary into `src-tauri/resources/` so Tauri bundles it as a resource.
//!
//! Runs on every cargo build of `src-tauri`. Re-runs only when the sidecar
//! source changes (cargo:rerun-if-changed directives).

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=../crates/kimbo-claude-statusline/src");
    println!("cargo:rerun-if-changed=../crates/kimbo-claude-statusline/Cargo.toml");

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let manifest_dir: PathBuf = std::env::var("CARGO_MANIFEST_DIR").unwrap().into();
    let workspace_target = manifest_dir
        .parent()
        .unwrap()
        .join("target")
        .join(&profile);
    let bin_name = if cfg!(windows) {
        "kimbo-claude-statusline.exe"
    } else {
        "kimbo-claude-statusline"
    };
    let src = workspace_target.join(bin_name);
    let dst_dir = manifest_dir.join("resources");
    let dst = dst_dir.join(bin_name);

    std::fs::create_dir_all(&dst_dir).expect("create resources dir");

    if !src.exists() {
        // Don't fail the build — the dev may not have built the sidecar yet.
        // The Tauri builder will warn if the resource is missing at bundle time.
        println!("cargo:warning=sidecar not yet built at {src:?}; run `cargo build -p kimbo-claude-statusline` first");
    } else {
        std::fs::copy(&src, &dst).expect("copy sidecar into resources");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dst).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dst, perms).unwrap();
        }
    }

    tauri_build::build();
}
