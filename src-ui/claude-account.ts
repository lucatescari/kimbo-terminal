import { invoke } from "@tauri-apps/api/core";

/** Claude Code account info derived from `claude auth status`. snake_case
 *  matches the Rust serde-serialized struct. */
export interface AccountInfo {
  logged_in: boolean;
  email: string | null;
  subscription_type: string | null;
}

let cached: AccountInfo | null = null;
let initialized = false;

/** Get the cached account info (loading it on first call). Returns null
 *  when claude isn't installed or the user isn't logged in. */
export async function getAccountInfo(): Promise<AccountInfo | null> {
  if (initialized) return cached;
  initialized = true;
  try {
    cached = await invoke<AccountInfo | null>("claude_account_info", { forceRefresh: false });
    return cached;
  } catch (e) {
    console.warn("getAccountInfo failed:", e);
    cached = null;
    return null;
  }
}

/** Force-refresh by re-running `claude auth status`. Updates the cache
 *  and returns the new value. Used by the Settings → Refresh button. */
export async function refreshAccount(): Promise<AccountInfo | null> {
  try {
    cached = await invoke<AccountInfo | null>("claude_account_info", { forceRefresh: true });
    initialized = true;
    return cached;
  } catch (e) {
    console.warn("refreshAccount failed:", e);
    return cached;
  }
}

/** Test-only — reset the module-local cache between tests. */
export function clearAccountCacheForTesting(): void {
  cached = null;
  initialized = false;
}
