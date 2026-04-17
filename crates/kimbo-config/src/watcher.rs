use anyhow::{Context, Result};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;

/// Watches the configuration file for changes and notifies via a channel.
pub struct ConfigWatcher {
    _watcher: RecommendedWatcher,
    pub rx: mpsc::Receiver<()>,
}

impl ConfigWatcher {
    /// Creates a new ConfigWatcher that monitors the given config file path.
    /// The watcher monitors the parent directory so it catches file creation,
    /// modification, and replacement.
    pub fn new(config_path: PathBuf) -> Result<Self> {
        let (tx, rx) = mpsc::channel();

        let watched_path = config_path.clone();
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // Only notify for modifications or creations that affect our config file
                let dominated = event.paths.iter().any(|p| p == &watched_path);
                if dominated {
                    let _ = tx.send(());
                }
            }
        })
        .context("Failed to create file watcher")?;

        // Watch the parent directory (non-recursive) so we catch file creation too
        let watch_dir = config_path
            .parent()
            .unwrap_or(&config_path)
            .to_path_buf();

        if watch_dir.exists() {
            watcher
                .watch(&watch_dir, RecursiveMode::NonRecursive)
                .with_context(|| format!("Failed to watch directory {:?}", watch_dir))?;
        } else {
            log::warn!(
                "Config directory {:?} does not exist yet; watcher will not be active",
                watch_dir
            );
        }

        Ok(Self {
            _watcher: watcher,
            rx,
        })
    }

    /// Non-blocking check whether the config file has changed since the last check.
    pub fn check_changed(&self) -> bool {
        // Drain all pending notifications and return true if any existed
        let mut changed = false;
        while self.rx.try_recv().is_ok() {
            changed = true;
        }
        changed
    }
}
