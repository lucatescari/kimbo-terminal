use kimbo_config::community::{fetch_index_sync, CommunityCache, CommunityIndex};
use kimbo_config::theme::{
    classify_slug, JsonResolvedTheme, JsonTheme, ThemeSource, ThemeSwatches, UnifiedTheme,
    BUILTIN_JSON_NAMES,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Tauri event emitted by the theme commands. Payload carries the unified
/// theme list AND metadata about the community catalog, so the UI can tell
/// an offline failure ("no community themes known") apart from the "you
/// already have all of them installed" state.
pub const THEMES_READY_EVENT: &str = "themes://community-ready";

#[derive(Debug, Clone, Serialize)]
pub struct ThemesReadyPayload {
    pub themes: Vec<UnifiedTheme>,
    /// Total number of themes in the community index, regardless of install
    /// state. `0` means the fetch failed OR the catalog really is empty.
    pub community_catalog_size: usize,
    /// `true` when the fetch was attempted and succeeded (from cache or
    /// network). `false` means no catalog was available to this emit.
    pub community_resolved: bool,
}

/// Tauri-managed shared state for the community fetch cache + single-flight guard.
/// Register this once in `main.rs` via `.manage(ThemeState::default())`.
pub struct ThemeState {
    pub cache: Arc<CommunityCache>,
}

impl Default for ThemeState {
    fn default() -> Self {
        Self { cache: CommunityCache::new() }
    }
}

/// Resolve a single theme by name/slug (unchanged public contract).
#[tauri::command]
pub fn get_theme(name: String) -> Result<JsonResolvedTheme, String> {
    if let Some(theme) = JsonTheme::load_by_name(&name) {
        return Ok(theme.resolve());
    }

    // Configured theme is not local. Try one-shot auto-install from the
    // community manifest (covers users who had catppuccin-* selected when
    // it was built-in but is now community-only).
    if let Some(idx) = fetch_index_sync_opt() {
        if let Some(entry) = idx.themes.iter().find(|e| e.slug == name) {
            let body = ureq::get(&entry.download_url)
                .header("User-Agent", "kimbo-terminal")
                .call()
                .ok()
                .and_then(|mut r| r.body_mut().read_to_string().ok());
            if let Some(body) = body {
                if serde_json::from_str::<JsonTheme>(&body).is_ok() {
                    let dir = kimbo_config::AppConfig::config_dir().join("themes");
                    if std::fs::create_dir_all(&dir).is_ok() {
                        let path = dir.join(format!("{}.json", name));
                        let _ = std::fs::write(&path, &body);
                    }
                    if let Some(theme) = JsonTheme::load_by_name(&name) {
                        log::info!(
                            "auto-installed '{}' from community manifest",
                            name
                        );
                        return Ok(theme.resolve());
                    }
                }
            }
        }
    }

    // Last resort: fall back to Kimbo Dark and log the substitution. We do
    // NOT mutate config.toml — if the user comes back online later, the
    // next launch resolves the configured theme properly.
    log::warn!(
        "configured theme '{}' unavailable; falling back to kimbo-dark",
        name
    );
    let fallback = JsonTheme::builtin("kimbo-dark")
        .ok_or_else(|| "kimbo-dark builtin missing — unreachable".to_string())?;
    Ok(fallback.resolve())
}

/// Synchronous return: Builtin + Installed only. Also spawns a background task
/// that populates the `Available` entries (from cache or network) and emits
/// `themes://community-ready` with the full updated list.
#[tauri::command]
pub fn list_unified_themes(
    app: AppHandle,
    state: State<'_, ThemeState>,
    active_slug: Option<String>,
) -> Vec<UnifiedTheme> {
    let active = active_slug.unwrap_or_default();

    // Built-ins + installed themes (synchronous — filesystem + binary reads).
    let installed_slugs = installed_theme_slugs();
    let local = build_local_unified(&installed_slugs, &active);
    log::info!(
        "list_unified_themes: {} local themes (builtin + installed), active='{}'; spawning community resolve",
        local.len(),
        active,
    );

    // Spawn the community resolver in the background. It always emits the
    // event (either immediately from cache, or after the fetch resolves).
    let cache = state.cache.clone();
    let active_for_task = active.clone();
    tauri::async_runtime::spawn(async move {
        emit_full_list(app, cache, active_for_task);
    });

    local
}

/// Install a community theme by slug: look up its `download_url` in the
/// cached `index.json`, fetch, validate, write to the user themes dir, then
/// re-emit the full unified list.
#[tauri::command]
pub fn install_theme(
    app: AppHandle,
    state: State<'_, ThemeState>,
    slug: String,
    active_slug: Option<String>,
) -> Result<(), String> {
    let idx = state.cache.get_fresh().or_else(fetch_index_sync_opt).ok_or_else(|| {
        "community manifest unavailable (offline or rate-limited)".to_string()
    })?;
    let entry = idx
        .themes
        .iter()
        .find(|e| e.slug == slug)
        .ok_or_else(|| format!("theme '{}' not found in community manifest", slug))?;

    let body = ureq::get(&entry.download_url)
        .header("User-Agent", "kimbo-terminal")
        .call()
        .map_err(|e| format!("fetch failed: {}", e))?
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("read failed: {}", e))?;

    let _validated: JsonTheme =
        serde_json::from_str(&body).map_err(|e| format!("invalid theme: {}", e))?;

    let dir = kimbo_config::AppConfig::config_dir().join("themes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {}", e))?;
    let path = dir.join(format!("{}.json", slug));
    std::fs::write(&path, body).map_err(|e| format!("write failed: {}", e))?;

    // Re-emit so the UI re-renders without a manual refresh.
    let active = active_slug.unwrap_or_default();
    let cache = state.cache.clone();
    tauri::async_runtime::spawn(async move {
        emit_full_list(app, cache, active);
    });

    Ok(())
}

/// Install a theme from a local `.json` file the user picked via the dialog.
/// Validates the payload, writes it to `~/.config/kimbo/themes/{slug}.json`,
/// and re-emits the unified list so the gallery refreshes without a manual
/// reload. The slug is derived from the file's stem (e.g.
/// `/Users/x/tokyo-night.json` → `tokyo-night`) with only ASCII letters,
/// digits, and `-`/`_` kept. Refuses to overwrite a built-in slug.
#[tauri::command]
pub fn install_theme_from_file(
    app: AppHandle,
    state: State<'_, ThemeState>,
    file_path: String,
    active_slug: Option<String>,
) -> Result<String, String> {
    let src = std::path::PathBuf::from(&file_path);
    let body = std::fs::read_to_string(&src)
        .map_err(|e| format!("read '{}': {}", src.display(), e))?;
    let _validated: JsonTheme =
        serde_json::from_str(&body).map_err(|e| format!("invalid theme: {}", e))?;

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "file has no stem".to_string())?;
    let slug = sanitize_slug(stem);
    if slug.is_empty() {
        return Err(format!(
            "could not derive a slug from filename '{}'",
            src.display()
        ));
    }
    if BUILTIN_JSON_NAMES.iter().any(|b| *b == slug) {
        return Err(format!(
            "'{}' collides with a built-in theme — rename the file and try again",
            slug
        ));
    }

    let dir = kimbo_config::AppConfig::config_dir().join("themes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {}", e))?;
    let dst = dir.join(format!("{}.json", slug));
    std::fs::write(&dst, &body).map_err(|e| format!("write failed: {}", e))?;

    log::info!(
        "install_theme_from_file: wrote '{}' from {}",
        slug,
        src.display()
    );

    let active = active_slug.unwrap_or_default();
    let cache = state.cache.clone();
    tauri::async_runtime::spawn(async move {
        emit_full_list(app, cache, active);
    });
    Ok(slug)
}

/// Keep lowercase ASCII letters/digits/`-`/`_`, drop everything else. Used
/// to turn an arbitrary filename stem into a safe theme slug.
fn sanitize_slug(stem: &str) -> String {
    stem.chars()
        .map(|c| c.to_ascii_lowercase())
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// Delete an installed community theme. Refuses Builtin and the active theme.
#[tauri::command]
pub fn delete_theme(
    app: AppHandle,
    state: State<'_, ThemeState>,
    slug: String,
    active_slug: Option<String>,
) -> Result<(), String> {
    if BUILTIN_JSON_NAMES.iter().any(|b| *b == slug) {
        return Err(format!("cannot delete built-in theme '{}'", slug));
    }
    if active_slug.as_deref() == Some(slug.as_str()) {
        return Err(format!(
            "'{}' is the active theme — switch to another theme first",
            slug
        ));
    }
    let path = kimbo_config::AppConfig::config_dir()
        .join("themes")
        .join(format!("{}.json", slug));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete failed: {}", e))?;
    }
    let active = active_slug.unwrap_or_default();
    let cache = state.cache.clone();
    tauri::async_runtime::spawn(async move {
        emit_full_list(app, cache, active);
    });
    Ok(())
}

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

fn installed_theme_slugs() -> Vec<String> {
    let Some(dir) = dirs::config_dir() else { return Vec::new(); };
    let themes_dir = dir.join("kimbo").join("themes");
    let Ok(entries) = std::fs::read_dir(themes_dir) else { return Vec::new(); };
    let mut slugs: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().is_some_and(|x| x == "json") {
                path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();
    // Drop any slug that's also a builtin (builtin wins — prevents dupes).
    slugs.retain(|s| !BUILTIN_JSON_NAMES.iter().any(|b| *b == s.as_str()));
    slugs
}

/// Build `Builtin` + `Installed` entries from local state only (no network).
fn build_local_unified(installed_slugs: &[String], active: &str) -> Vec<UnifiedTheme> {
    let mut out = Vec::new();

    // Built-ins first (alphabetical by slug).
    let mut builtin: Vec<&&str> = BUILTIN_JSON_NAMES.iter().collect();
    builtin.sort();
    for slug_ref in builtin {
        let slug = (*slug_ref).to_string();
        if let Some(theme) = JsonTheme::builtin(&slug) {
            out.push(UnifiedTheme {
                slug: slug.clone(),
                name: theme.name.clone(),
                theme_type: theme.theme_type.clone(),
                author: theme.author.clone(),
                version: theme.version.clone(),
                swatches: theme.swatches(),
                source: ThemeSource::Builtin,
                active: slug == active,
            });
        }
    }

    // Installed (alphabetical).
    let mut installed: Vec<&String> = installed_slugs.iter().collect();
    installed.sort();
    for slug in installed {
        if let Some(theme) = JsonTheme::load_by_name(slug) {
            out.push(UnifiedTheme {
                slug: slug.clone(),
                name: theme.name.clone(),
                theme_type: theme.theme_type.clone(),
                author: theme.author.clone(),
                version: theme.version.clone(),
                swatches: theme.swatches(),
                source: ThemeSource::Installed,
                active: *slug == active,
            });
        }
    }
    out
}

/// Fetch (using cache if fresh, else network via single-flight) and emit the
/// full unified list. Errors are logged and an event is still fired with
/// just local themes so the UI can update its "loading" state.
fn emit_full_list(app: AppHandle, cache: Arc<CommunityCache>, active: String) {
    let installed = installed_theme_slugs();
    let mut unified = build_local_unified(&installed, &active);
    let mut catalog_size: usize = 0;
    let mut resolved = false;

    let idx_opt = if let Some(idx) = cache.get_fresh() {
        log::info!("community index: cache hit ({} entries)", idx.themes.len());
        Some(idx)
    } else if cache.begin_fetch() {
        log::info!("community index: cache miss, fetching {}", INDEX_URL_FOR_LOG);
        // RAII guard: always call finish_fetch even if fetch_index_sync panics.
        // Without this, a panic inside ureq or serde leaves the single-flight
        // flag stuck at `true` until process restart.
        struct FetchGuard<'a> {
            cache: &'a CommunityCache,
            result: Option<CommunityIndex>,
        }
        impl Drop for FetchGuard<'_> {
            fn drop(&mut self) {
                self.cache.finish_fetch(self.result.take());
            }
        }
        let mut guard = FetchGuard { cache: &cache, result: None };
        guard.result = fetch_index_sync().ok();
        guard.result.clone()
    } else {
        // Another caller is fetching; skip and emit just locals.
        log::info!("community index: another caller already fetching; emitting locals only");
        None
    };

    if let Some(idx) = idx_opt {
        log::info!("community index resolved with {} entries; classifying…", idx.themes.len());
        catalog_size = idx.themes.len();
        resolved = true;
        for entry in &idx.themes {
            let source = classify_slug(&entry.slug, &installed);
            if source != ThemeSource::Available {
                continue; // Builtin/Installed already included above.
            }
            unified.push(UnifiedTheme {
                slug: entry.slug.clone(),
                name: entry.name.clone(),
                theme_type: entry.theme_type.clone(),
                author: entry.author.clone(),
                version: entry.version.clone(),
                swatches: ThemeSwatches {
                    background: entry.swatches.background.clone(),
                    foreground: entry.swatches.foreground.clone(),
                    accent: entry.swatches.accent.clone(),
                    cursor: entry.swatches.cursor.clone(),
                },
                source: ThemeSource::Available,
                active: entry.slug == active,
            });
        }
    }

    let available = unified.iter().filter(|t| t.source == ThemeSource::Available).count();
    let installed_cnt = unified.iter().filter(|t| t.source == ThemeSource::Installed).count();
    let builtin_cnt = unified.iter().filter(|t| t.source == ThemeSource::Builtin).count();
    log::info!(
        "emit themes://community-ready: total={} (builtin={}, installed={}, available={}) catalog={} resolved={}",
        unified.len(), builtin_cnt, installed_cnt, available, catalog_size, resolved,
    );
    let payload = ThemesReadyPayload {
        themes: unified,
        community_catalog_size: catalog_size,
        community_resolved: resolved,
    };
    let _ = app.emit(THEMES_READY_EVENT, &payload);
}

// Stable logging label for the community index URL (mirrors the const in
// kimbo-config::community so we don't leak internal names into logs).
const INDEX_URL_FOR_LOG: &str =
    "https://raw.githubusercontent.com/lucatescari/kimbo-themes/main/index.json";

/// Wrapper: try a synchronous fetch and return `Option` for fallback chaining.
fn fetch_index_sync_opt() -> Option<CommunityIndex> {
    match fetch_index_sync() {
        Ok(idx) => Some(idx),
        Err(e) => {
            log::warn!("community index fetch failed: {}", e);
            None
        }
    }
}
