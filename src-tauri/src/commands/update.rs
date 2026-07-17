//! Channel-aware update checks and installs, built on tauri-plugin-updater.
//! The channel ("stable" | "unstable") selects which `latest.json` manifest
//! the updater reads. The same signing key verifies both channels.

use serde::Serialize;
use std::sync::Mutex;
use tauri_plugin_updater::UpdaterExt;

const STABLE_MANIFEST: &str =
    "https://github.com/lucatescari/kimbo-terminal/releases/latest/download/latest.json";
const UNSTABLE_MANIFEST: &str =
    "https://github.com/lucatescari/kimbo-terminal/releases/download/unstable/latest.json";
const STABLE_PAGE: &str = "https://github.com/lucatescari/kimbo-terminal/releases/latest";
const UNSTABLE_PAGE: &str = "https://github.com/lucatescari/kimbo-terminal/releases/tag/unstable";

/// Map a channel to its `latest.json` URL. Unknown channels fall back to stable.
pub(crate) fn manifest_url(channel: &str) -> tauri::Url {
    let raw = if channel == "unstable" {
        UNSTABLE_MANIFEST
    } else {
        STABLE_MANIFEST
    };
    tauri::Url::parse(raw).expect("hardcoded manifest URL is valid")
}

/// Human-readable release page for the channel (for the "Release page" link).
pub(crate) fn release_url(channel: &str) -> &'static str {
    if channel == "unstable" {
        UNSTABLE_PAGE
    } else {
        STABLE_PAGE
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateStatus {
    /// Current build version, e.g. "1.2.0" or "1.3.0-unstable.4".
    pub current: String,
    /// True iff the channel manifest offers a newer version.
    pub available: bool,
    /// The offered version when `available`, else None.
    pub latest: Option<String>,
    /// Release notes from the manifest when `available`, else None.
    pub notes: Option<String>,
    /// Channel release page URL.
    pub release_url: String,
}

/// Process-lifetime cache keyed by channel. Tauri-managed.
#[derive(Default)]
pub struct UpdateCache(pub Mutex<Option<(String, UpdateStatus)>>);

/// Check the given channel for an update. Caches per channel; `force` bypasses.
#[tauri::command]
pub async fn check_update(
    app: tauri::AppHandle,
    cache: tauri::State<'_, UpdateCache>,
    channel: String,
    force: bool,
) -> Result<UpdateStatus, String> {
    if !force {
        if let Ok(guard) = cache.0.lock() {
            if let Some((ch, status)) = guard.as_ref() {
                if *ch == channel {
                    return Ok(status.clone());
                }
            }
        }
    }

    let current = env!("CARGO_PKG_VERSION").to_string();
    let updater = app
        .updater_builder()
        .endpoints(vec![manifest_url(&channel)])
        .map_err(|e| format!("endpoint error: {e}"))?
        .build()
        .map_err(|e| format!("updater build error: {e}"))?;

    let maybe = updater
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?;
    let status = match maybe {
        Some(update) => UpdateStatus {
            current,
            available: true,
            latest: Some(update.version.clone()),
            notes: update.body.clone(),
            release_url: release_url(&channel).to_string(),
        },
        None => UpdateStatus {
            current,
            available: false,
            latest: None,
            notes: None,
            release_url: release_url(&channel).to_string(),
        },
    };

    if let Ok(mut guard) = cache.0.lock() {
        *guard = Some((channel, status.clone()));
    }
    Ok(status)
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Shared install routine: build the updater for `url`, optionally allowing a
/// downgrade, download with progress, install, and restart. Never returns on
/// success (the process restarts).
async fn run_install(
    app: tauri::AppHandle,
    url: tauri::Url,
    allow_downgrade: bool,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| format!("endpoint error: {e}"))?;
    if allow_downgrade {
        // Treat any version different from current as installable.
        builder = builder.version_comparator(|current, remote| remote.version != current);
    }
    let updater = builder
        .build()
        .map_err(|e| format!("updater build error: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?
        .ok_or_else(|| "No update available".to_string())?;

    let mut downloaded: u64 = 0;
    let progress = on_progress.clone();
    update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded += chunk_len as u64;
                let _ = progress.send(DownloadProgress {
                    downloaded,
                    total: content_len,
                });
            },
            || {},
        )
        .await
        .map_err(|e| format!("install failed: {e}"))?;

    app.restart();
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    channel: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    run_install(app.clone(), manifest_url(&channel), false, on_progress).await
}

#[tauri::command]
pub async fn reinstall_stable(
    app: tauri::AppHandle,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    run_install(app.clone(), manifest_url("stable"), true, on_progress).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_url_selects_channel() {
        assert_eq!(
            manifest_url("stable").as_str(),
            "https://github.com/lucatescari/kimbo-terminal/releases/latest/download/latest.json"
        );
        assert_eq!(
            manifest_url("unstable").as_str(),
            "https://github.com/lucatescari/kimbo-terminal/releases/download/unstable/latest.json"
        );
        // Unknown channel falls back to stable.
        assert_eq!(
            manifest_url("wat").as_str(),
            manifest_url("stable").as_str()
        );
    }

    #[test]
    fn release_url_selects_channel() {
        assert_eq!(
            release_url("unstable"),
            "https://github.com/lucatescari/kimbo-terminal/releases/tag/unstable"
        );
        assert_eq!(
            release_url("stable"),
            "https://github.com/lucatescari/kimbo-terminal/releases/latest"
        );
    }
}
