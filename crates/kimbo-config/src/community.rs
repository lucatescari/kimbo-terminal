//! Community theme manifest: parses `index.json` from the kimbo-themes repo.

use serde::{Deserialize, Serialize};

/// Root of the generated `index.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunityIndex {
    pub generated: String,
    pub themes: Vec<CommunityThemeEntry>,
}

/// One theme entry in `index.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunityThemeEntry {
    pub slug: String,
    pub name: String,
    #[serde(rename = "type")]
    pub theme_type: String,
    pub author: String,
    pub version: String,
    pub swatches: ManifestSwatches,
    pub download_url: String,
}

/// Swatches embedded in the manifest (mirrors `ThemeSwatches`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestSwatches {
    pub background: String,
    pub foreground: String,
    pub accent: String,
    pub cursor: String,
}

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const INDEX_URL: &str =
    "https://raw.githubusercontent.com/lucatescari/kimbo-themes/main/index.json";
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);

/// In-process cache of the fetched community index, shared across calls.
pub struct CommunityCache {
    inner: Mutex<CacheInner>,
}

struct CacheInner {
    /// Last successful fetch, if any.
    value: Option<(CommunityIndex, Instant)>,
    /// A fetch is currently running; other callers should wait or skip.
    fetching: bool,
}

impl Default for CommunityCache {
    fn default() -> Self {
        Self {
            inner: Mutex::new(CacheInner {
                value: None,
                fetching: false,
            }),
        }
    }
}

impl CommunityCache {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Returns a cached index if it's fresh (`< CACHE_TTL`). Does not hit the
    /// network. Public so the command layer can decide whether to skip the
    /// spawned fetch.
    pub fn get_fresh(&self) -> Option<CommunityIndex> {
        let guard = self.inner.lock().ok()?;
        match &guard.value {
            Some((idx, at)) if at.elapsed() < CACHE_TTL => Some(idx.clone()),
            _ => None,
        }
    }

    /// Begin a fetch if one is not already in flight. Returns `true` if this
    /// caller should perform the fetch, `false` if another caller is already
    /// fetching (the other caller will populate the cache).
    pub fn begin_fetch(&self) -> bool {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        if guard.fetching {
            return false;
        }
        guard.fetching = true;
        true
    }

    /// Mark the fetch as complete and store the result. Always pair with
    /// a `begin_fetch() == true` caller.
    pub fn finish_fetch(&self, result: Option<CommunityIndex>) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.fetching = false;
            if let Some(idx) = result {
                guard.value = Some((idx, Instant::now()));
            }
        }
    }
}

/// Fetch `index.json` synchronously via `ureq`. Returns parsed `CommunityIndex`
/// on success, or an error with a concise message suitable for logging.
pub fn fetch_index_sync() -> anyhow::Result<CommunityIndex> {
    let body = ureq::get(INDEX_URL)
        .header("User-Agent", "kimbo-terminal")
        .call()
        .map_err(|e| anyhow::anyhow!("fetch failed: {e}"))?
        .body_mut()
        .read_to_string()
        .map_err(|e| anyhow::anyhow!("read failed: {e}"))?;
    let idx: CommunityIndex = serde_json::from_str(&body)
        .map_err(|e| anyhow::anyhow!("parse failed: {e}"))?;
    Ok(idx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_community_index() {
        let json = r##"{
            "generated": "2026-04-17T00:00:00Z",
            "themes": [
              {
                "slug": "catppuccin-mocha",
                "name": "Catppuccin Mocha",
                "type": "dark",
                "author": "lucatescari",
                "version": "1.0.0",
                "swatches": {
                  "background": "#1e1e2e",
                  "foreground": "#cdd6f4",
                  "accent": "#89b4fa",
                  "cursor": "#f5e0dc"
                },
                "download_url": "https://example.invalid/mocha.json"
              }
            ]
          }"##;
        let idx: CommunityIndex = serde_json::from_str(json).unwrap();
        assert_eq!(idx.themes.len(), 1);
        assert_eq!(idx.themes[0].slug, "catppuccin-mocha");
        assert_eq!(idx.themes[0].author, "lucatescari");
        assert_eq!(idx.themes[0].swatches.accent, "#89b4fa");
    }

    #[test]
    fn test_cache_get_fresh_returns_none_when_empty() {
        let cache = CommunityCache::default();
        assert!(cache.get_fresh().is_none());
    }

    #[test]
    fn test_cache_single_flight_guard() {
        let cache = CommunityCache::default();
        assert!(cache.begin_fetch(), "first begin_fetch should succeed");
        assert!(!cache.begin_fetch(), "second begin_fetch while in-flight should fail");
        cache.finish_fetch(None);
        assert!(cache.begin_fetch(), "after finish, begin_fetch should succeed again");
        cache.finish_fetch(None);
    }

    #[test]
    fn test_cache_stores_and_returns_value() {
        let cache = CommunityCache::default();
        let sample = CommunityIndex {
            generated: "now".to_string(),
            themes: vec![],
        };
        assert!(cache.begin_fetch());
        cache.finish_fetch(Some(sample.clone()));
        let got = cache.get_fresh().expect("fresh value should be present");
        assert_eq!(got.generated, "now");
    }
}
