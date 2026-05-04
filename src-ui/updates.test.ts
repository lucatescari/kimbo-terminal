import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const updatesSource = readFileSync(resolve(__dirname, "updates.ts"), "utf-8");

describe("updates: module exports", () => {
  it("exports initUpdateCheck", () => {
    expect(updatesSource).toContain("export async function initUpdateCheck");
  });

  it("exports getCachedUpdate", () => {
    expect(updatesSource).toContain("export function getCachedUpdate");
  });

  it("exports forceCheckUpdate", () => {
    expect(updatesSource).toContain("export async function forceCheckUpdate");
  });

  it("exports hasPendingUpdate", () => {
    expect(updatesSource).toContain("export function hasPendingUpdate");
  });

  it("exports the UpdateInfo type", () => {
    expect(updatesSource).toContain("export interface UpdateInfo");
  });
});

// --- Behavior tests with mocked invoke ---
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("./toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("./settings", () => ({
  openSettingsToCategory: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  initUpdateCheck,
  getCachedUpdate,
  forceCheckUpdate,
  hasPendingUpdate,
  __resetUpdateCacheForTests,
} from "./updates";
import { showToast } from "./toast";
import { openSettingsToCategory } from "./settings";

const fakeInfo = {
  current: "0.2.1",
  latest: "0.3.0",
  is_newer: true,
  release_url: "https://example.com/r",
  published_at: "2026-04-15T10:00:00Z",
  notes: "Notes",
};

describe("updates: cache behavior", () => {
  beforeEach(() => {
    __resetUpdateCacheForTests();
    vi.mocked(invoke).mockReset();
  });

  it("starts with no cached info", () => {
    expect(getCachedUpdate()).toBeNull();
    expect(hasPendingUpdate()).toBe(false);
  });

  it("forceCheckUpdate populates the cache", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(fakeInfo);
    const result = await forceCheckUpdate();
    expect(result).toEqual(fakeInfo);
    expect(getCachedUpdate()).toEqual(fakeInfo);
    expect(hasPendingUpdate()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("check_for_updates", { force: true });
  });

  it("initUpdateCheck calls the command when auto_check is true", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(fakeInfo);
    await initUpdateCheck({ updates: { auto_check: true } } as any);
    expect(invoke).toHaveBeenCalledWith("check_for_updates", { force: false });
    expect(getCachedUpdate()).toEqual(fakeInfo);
  });

  it("initUpdateCheck skips the command when auto_check is false", async () => {
    await initUpdateCheck({ updates: { auto_check: false } } as any);
    expect(invoke).not.toHaveBeenCalled();
    expect(getCachedUpdate()).toBeNull();
  });

  it("initUpdateCheck swallows network errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await expect(
      initUpdateCheck({ updates: { auto_check: true } } as any),
    ).resolves.toBeUndefined();
    expect(getCachedUpdate()).toBeNull();
  });

  it("forceCheckUpdate propagates errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await expect(forceCheckUpdate()).rejects.toThrow("offline");
  });

  it("hasPendingUpdate is false when latest is not newer", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...fakeInfo, is_newer: false });
    await forceCheckUpdate();
    expect(hasPendingUpdate()).toBe(false);
  });
});

describe("updates: launch toast", () => {
  beforeEach(() => {
    __resetUpdateCacheForTests();
    vi.mocked(invoke).mockReset();
    vi.mocked(showToast).mockReset();
    vi.mocked(openSettingsToCategory).mockReset();
  });

  it("shows a persistent actionable toast when initUpdateCheck finds an update", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(fakeInfo);
    await initUpdateCheck({ updates: { auto_check: true } } as any);
    expect(showToast).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(showToast).mock.calls[0][0];
    expect(opts.message).toContain("0.3.0");
    expect(opts.durationMs).toBe(0);
    expect(typeof opts.onClick).toBe("function");
  });

  it("toast onClick navigates to the About settings panel", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(fakeInfo);
    await initUpdateCheck({ updates: { auto_check: true } } as any);
    const opts = vi.mocked(showToast).mock.calls[0][0];
    opts.onClick!();
    expect(openSettingsToCategory).toHaveBeenCalledWith("about");
  });

  it("does not show a toast when the launch check finds no newer version", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...fakeInfo, is_newer: false });
    await initUpdateCheck({ updates: { auto_check: true } } as any);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not show a toast when auto_check is disabled", async () => {
    await initUpdateCheck({ updates: { auto_check: false } } as any);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not show a toast when the launch check fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await initUpdateCheck({ updates: { auto_check: true } } as any);
    expect(showToast).not.toHaveBeenCalled();
  });
});
