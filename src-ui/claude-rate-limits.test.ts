import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getRateLimits, installRateLimits, uninstallRateLimits } from "./claude-rate-limits";

describe("getRateLimits", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("returns the parsed payload", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      five_hour: { used_percentage: 47, resets_at: 1777902000 },
      seven_day: { used_percentage: 23, resets_at: 1778234400 },
      captured_at_ms: 1714478531000,
      version_too_old: false,
    });
    const r = await getRateLimits();
    expect(r?.five_hour?.used_percentage).toBe(47);
    expect(r?.five_hour?.resets_at).toBe(1777902000);
  });

  it("returns null when the cmd returns null", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await getRateLimits()).toBeNull();
  });

  it("returns null when the cmd throws", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    expect(await getRateLimits()).toBeNull();
  });
});

describe("installRateLimits", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("invokes claude_rate_limits_install with force flag", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ kind: "Installed" });
    await installRateLimits(true);
    expect(invoke).toHaveBeenCalledWith("claude_rate_limits_install", { force: true });
  });
});

describe("uninstallRateLimits", () => {
  it("invokes claude_rate_limits_uninstall", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await uninstallRateLimits();
    expect(invoke).toHaveBeenCalledWith("claude_rate_limits_uninstall");
  });
});
