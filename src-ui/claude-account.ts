import { invoke } from "@tauri-apps/api/core";

/** Claude Code account info derived from `claude auth status`. snake_case
 *  matches the Rust serde-serialized struct. */
export interface AccountInfo {
  logged_in: boolean;
  email: string | null;
  subscription_type: string | null;
}

/** Fetch the current account info. Caching and login-switch invalidation live
 *  in the Rust `claude_account_info` command (it re-runs `claude auth status`
 *  only when the `~/.claude.json` account-email signal changes), so this is a
 *  thin pass-through that always queries. The HUD's 2s poll therefore reflects
 *  an account switch within one cycle instead of showing the previous user's
 *  email until restart (issue #9). Returns null when claude isn't installed or
 *  the user isn't logged in. */
export async function getAccountInfo(): Promise<AccountInfo | null> {
  try {
    return await invoke<AccountInfo | null>("claude_account_info", { forceRefresh: false });
  } catch (e) {
    console.warn("getAccountInfo failed:", e);
    return null;
  }
}

/** Force-refresh by re-running `claude auth status` regardless of the cached
 *  value. Used by the Settings → Refresh button. */
export async function refreshAccount(): Promise<AccountInfo | null> {
  try {
    return await invoke<AccountInfo | null>("claude_account_info", { forceRefresh: true });
  } catch (e) {
    console.warn("refreshAccount failed:", e);
    return null;
  }
}
