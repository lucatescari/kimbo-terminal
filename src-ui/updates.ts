import { invoke } from "@tauri-apps/api/core";

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

let cached: UpdateInfo | null = null;

/** Called once at app startup. Honors the auto_check toggle. Never throws. */
export async function initUpdateCheck(config: ConfigShape): Promise<void> {
  if (!config.updates?.auto_check) return;
  try {
    cached = await invoke<UpdateInfo>("check_for_updates", { force: false });
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

/** Test helper — resets module state between cases. Not for app code. */
export function __resetUpdateCacheForTests(): void {
  cached = null;
}
