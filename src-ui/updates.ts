import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { showToast } from "./toast";
import { openSettingsToCategory } from "./settings";

export interface UpdateInfo {
  current: string;
  latest: string;
  is_newer: boolean;
  release_url: string;
  published_at: string;
  notes: string;
}

interface ConfigShape {
  updates: { auto_check: boolean };
}

export interface DownloadProgress {
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total bytes of the updater artifact, or null if the server did not send Content-Length. */
  total: number | null;
}

let cached: UpdateInfo | null = null;

/** Called once at app startup. Honors the auto_check toggle. Never throws. */
export async function initUpdateCheck(config: ConfigShape): Promise<void> {
  if (!config.updates?.auto_check) return;
  try {
    cached = await invoke<UpdateInfo>("check_for_updates", { force: false });
    if (cached?.is_newer) {
      showToast({
        kind: "info",
        message: `Update available: v${cached.latest}`,
        detail: "Click to install",
        durationMs: 0,
        onClick: () => {
          void openSettingsToCategory("about");
        },
      });
    }
  } catch (e) {
    console.warn("Auto update check failed:", e);
  }
}

/** Synchronous read of the in-memory cache. */
export function getCachedUpdate(): UpdateInfo | null {
  return cached;
}

/** Bypass the backend cache, refetch, and update the in-memory cache. */
export async function forceCheckUpdate(): Promise<UpdateInfo> {
  const info = await invoke<UpdateInfo>("check_for_updates", { force: true });
  cached = info;
  return info;
}

/** Convenience: true iff a check has succeeded and the remote is newer. */
export function hasPendingUpdate(): boolean {
  return cached?.is_newer === true;
}

/**
 * Download the latest release via tauri-plugin-updater and install it.
 *
 * The plugin hits `plugins.updater.endpoints` in tauri.conf.json, fetches
 * the signed tarball, verifies it against the embedded pubkey, writes it
 * over the current .app bundle, and relaunches. The `onProgress` callback
 * fires once with `downloaded: 0` when the transfer starts, periodically
 * during the download, and once with `downloaded === total` when done.
 *
 * Throws if no update is available, signature verification fails, or the
 * server is unreachable. Never returns on success — the process relaunches.
 */
export async function downloadAndInstallUpdate(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const update: Update | null = await check();
  if (!update) throw new Error("No update available");

  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = typeof event.data.contentLength === "number" ? event.data.contentLength : null;
      onProgress?.({ downloaded: 0, total });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.({ downloaded, total });
    } else if (event.event === "Finished") {
      onProgress?.({ downloaded: total ?? downloaded, total });
    }
  });

  await relaunch();
}

/** Test helper — resets module state between cases. Not for app code. */
export function __resetUpdateCacheForTests(): void {
  cached = null;
}
