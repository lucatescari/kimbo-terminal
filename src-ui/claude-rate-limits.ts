import { invoke } from "@tauri-apps/api/core";

export interface LimitWindow {
  used_percentage: number;
  /** Unix timestamp in seconds. */
  resets_at: number;
}

export interface RateLimits {
  five_hour: LimitWindow | null;
  seven_day: LimitWindow | null;
  captured_at_ms: number;
  version_too_old: boolean;
  /** Account this snapshot was captured under (from `~/.claude.json`).
   *  Null for caches written before this field existed. Used by the HUD to
   *  suppress a previous account's stale numbers after a login switch. */
  account_email: string | null;
}

export type InstallOutcome =
  | { kind: "Installed" }
  | { kind: "Pending"; existing: string }
  | { kind: "NoOp" };

export async function getRateLimits(): Promise<RateLimits | null> {
  try {
    const r = await invoke<RateLimits | null>("claude_rate_limits");
    return r ?? null;
  } catch (err) {
    console.warn("getRateLimits failed:", err);
    return null;
  }
}

export async function installRateLimits(force: boolean): Promise<InstallOutcome> {
  return await invoke<InstallOutcome>("claude_rate_limits_install", { force });
}

export async function uninstallRateLimits(): Promise<void> {
  await invoke<void>("claude_rate_limits_uninstall");
}
