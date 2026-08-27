import { invoke, Channel } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { showToast } from "./toast";
import { openSettingsToCategory } from "./settings";

export interface UpdateStatus {
  current: string;
  /** Short git SHA this build was compiled from, e.g. "a2fnd4f", with a
   *  "-dirty" suffix if the tree had uncommitted changes. "unknown" outside
   *  a git checkout. Stamped by src-tauri/build.rs. */
  build_id: string;
  available: boolean;
  latest: string | null;
  notes: string | null;
  release_url: string;
}

export interface DownloadProgress {
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total bytes of the updater artifact, or null if the server did not send Content-Length. */
  total: number | null;
}

interface ConfigShape {
  updates?: { auto_check?: boolean; channel?: string };
}

let cached: UpdateStatus | null = null;

function channelOf(config: ConfigShape): string {
  return config.updates?.channel === "unstable" ? "unstable" : "stable";
}

/** Called once at app startup. Honors auto_check. Never throws. */
export async function initUpdateCheck(config: ConfigShape): Promise<void> {
  if (!config.updates?.auto_check) return;
  const channel = channelOf(config);
  try {
    cached = await invoke<UpdateStatus>("check_update", { channel, force: false });
    if (cached?.available) {
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
/** Render a build's full identity, e.g. "1.2.1-unstable.3 (a2fnd4f)".
 *
 *  The version alone does not say which source a build came from: an
 *  unstable preview and the stable release promoted from it are the same
 *  code but carry different version strings. The build id is the commit, so
 *  matching ids mean matching source. See docs/release-identity.md.
 *
 *  Builds with no git metadata report "unknown"; there is nothing useful to
 *  show a user in that case, so the version stands alone. */
export function formatBuildLabel(
  version: string,
  buildId: string | null | undefined,
): string {
  const id = (buildId ?? "").trim();
  if (!id || id === "unknown") return version;
  return `${version} (${id})`;
}

export function getCachedUpdate(): UpdateStatus | null {
  return cached;
}

/** Bypass the backend cache, refetch, and update the in-memory cache. */
export async function forceCheckUpdate(channel: string): Promise<UpdateStatus> {
  const info = await invoke<UpdateStatus>("check_update", { channel, force: true });
  cached = info;
  return info;
}

/** Convenience: true iff a check has succeeded and an update is available. */
export function hasPendingUpdate(): boolean {
  return cached?.available === true;
}

function progressChannel(onProgress?: (p: DownloadProgress) => void): Channel<DownloadProgress> {
  const ch = new Channel<DownloadProgress>();
  if (onProgress) ch.onmessage = (p) => onProgress(p);
  return ch;
}

/**
 * Install the newest build on `channel`.
 *
 * Progress is streamed from the backend via a Tauri `Channel` and forwarded
 * to `onProgress`. Never returns on success — the process relaunches.
 */
export async function installUpdate(
  channel: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  await invoke("install_update", { channel, onProgress: progressChannel(onProgress) });
  await relaunch();
}

/** Force-install the latest stable build even if it is a downgrade. */
export async function reinstallStable(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  await invoke("reinstall_stable", { onProgress: progressChannel(onProgress) });
  await relaunch();
}

/** Test helper — resets module state between cases. Not for app code. */
export function __resetUpdateCacheForTests(): void {
  cached = null;
}
