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

  it("exports installUpdate", () => {
    expect(updatesSource).toContain("export async function installUpdate");
  });

  it("exports reinstallStable", () => {
    expect(updatesSource).toContain("export async function reinstallStable");
  });

  it("exports the UpdateStatus type", () => {
    expect(updatesSource).toContain("export interface UpdateStatus");
  });
});

// --- Behavior tests with mocked invoke ---
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((p: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("./toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("./settings", () => ({
  openSettingsToCategory: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  initUpdateCheck,
  getCachedUpdate,
  forceCheckUpdate,
  hasPendingUpdate,
  installUpdate,
  reinstallStable,
  __resetUpdateCacheForTests,
} from "./updates";
import { showToast } from "./toast";
import { openSettingsToCategory } from "./settings";

const fakeStatus = {
  current: "0.2.1",
  available: true,
  latest: "0.3.0",
  notes: "Notes",
  release_url: "https://example.com/r",
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
    vi.mocked(invoke).mockResolvedValueOnce(fakeStatus);
    const result = await forceCheckUpdate("stable");
    expect(result).toEqual(fakeStatus);
    expect(getCachedUpdate()).toEqual(fakeStatus);
    expect(hasPendingUpdate()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("check_update", { channel: "stable", force: true });
  });

  it("initUpdateCheck calls the command when auto_check is true", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(fakeStatus);
    await initUpdateCheck({ updates: { auto_check: true, channel: "stable" } });
    expect(invoke).toHaveBeenCalledWith("check_update", { channel: "stable", force: false });
    expect(getCachedUpdate()).toEqual(fakeStatus);
  });

  it("initUpdateCheck skips the command when auto_check is false", async () => {
    await initUpdateCheck({ updates: { auto_check: false, channel: "stable" } });
    expect(invoke).not.toHaveBeenCalled();
    expect(getCachedUpdate()).toBeNull();
  });

  it("initUpdateCheck swallows network errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await expect(
      initUpdateCheck({ updates: { auto_check: true, channel: "stable" } }),
    ).resolves.toBeUndefined();
    expect(getCachedUpdate()).toBeNull();
  });

  it("forceCheckUpdate propagates errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await expect(forceCheckUpdate("stable")).rejects.toThrow("offline");
  });

  it("hasPendingUpdate is false when no update is available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...fakeStatus, available: false });
    await forceCheckUpdate("stable");
    expect(hasPendingUpdate()).toBe(false);
  });

  it("forwards the channel to check_update and caches the result", async () => {
    const fn = vi.fn().mockResolvedValue({
      current: "1.2.0",
      available: true,
      latest: "1.3.0-unstable.2",
      notes: "preview",
      release_url: "https://example/unstable",
    });
    vi.mocked(invoke).mockImplementation(fn);
    __resetUpdateCacheForTests();

    await initUpdateCheck({ updates: { auto_check: true, channel: "unstable" } });

    expect(fn).toHaveBeenCalledWith("check_update", { channel: "unstable", force: false });
    expect(getCachedUpdate()?.latest).toBe("1.3.0-unstable.2");
  });

  it("skips the check when auto_check is off", async () => {
    const fn = vi.fn();
    vi.mocked(invoke).mockImplementation(fn);
    __resetUpdateCacheForTests();
    await initUpdateCheck({ updates: { auto_check: false, channel: "stable" } });
    expect(fn).not.toHaveBeenCalled();
  });

  it("normalizes a missing channel to stable", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...fakeStatus, available: false });
    await initUpdateCheck({ updates: { auto_check: true } });
    expect(invoke).toHaveBeenCalledWith("check_update", { channel: "stable", force: false });
  });

  it("normalizes an unknown channel value to stable", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...fakeStatus, available: false });
    await initUpdateCheck({ updates: { auto_check: true, channel: "beta" } });
    expect(invoke).toHaveBeenCalledWith("check_update", { channel: "stable", force: false });
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
    vi.mocked(invoke).mockResolvedValueOnce(fakeStatus);
    await initUpdateCheck({ updates: { auto_check: true, channel: "stable" } });
    expect(showToast).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(showToast).mock.calls[0][0];
    expect(opts.kind).toBe("info");
    expect(opts.message).toContain("0.3.0");
    expect(opts.detail).toBe("Click to install");
    expect(opts.durationMs).toBe(0);
    expect(typeof opts.onClick).toBe("function");
  });

  it("toast onClick navigates to the About settings panel", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(fakeStatus);
    await initUpdateCheck({ updates: { auto_check: true, channel: "stable" } });
    const opts = vi.mocked(showToast).mock.calls[0][0];
    opts.onClick!();
    expect(openSettingsToCategory).toHaveBeenCalledWith("about");
  });

  it("does not show a toast when the launch check finds no newer version", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...fakeStatus, available: false });
    await initUpdateCheck({ updates: { auto_check: true, channel: "stable" } });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not show a toast when auto_check is disabled", async () => {
    await initUpdateCheck({ updates: { auto_check: false, channel: "stable" } });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not show a toast when the launch check fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await initUpdateCheck({ updates: { auto_check: true, channel: "stable" } });
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("updates: install flow", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(relaunch).mockReset();
  });

  it("installUpdate forwards the channel and a progress Channel, then relaunches", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const onProgress = vi.fn();

    await installUpdate("unstable", onProgress);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(invoke).mock.calls[0];
    expect(cmd).toBe("install_update");
    expect((args as any).channel).toBe("unstable");
    const channelArg = (args as any).onProgress;
    expect(channelArg).toBeDefined();

    channelArg.onmessage({ downloaded: 10, total: 100 });
    expect(onProgress).toHaveBeenCalledWith({ downloaded: 10, total: 100 });

    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("installUpdate works without an onProgress callback", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await installUpdate("stable");
    expect(invoke).toHaveBeenCalledWith(
      "install_update",
      expect.objectContaining({ channel: "stable" }),
    );
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("installUpdate propagates errors and does not relaunch", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("checksum mismatch"));
    await expect(installUpdate("stable")).rejects.toThrow("checksum mismatch");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("reinstallStable forwards a progress Channel and relaunches", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const onProgress = vi.fn();

    await reinstallStable(onProgress);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(invoke).mock.calls[0];
    expect(cmd).toBe("reinstall_stable");
    const channelArg = (args as any).onProgress;
    expect(channelArg).toBeDefined();

    channelArg.onmessage({ downloaded: 5, total: null });
    expect(onProgress).toHaveBeenCalledWith({ downloaded: 5, total: null });

    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("reinstallStable propagates errors and does not relaunch", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await expect(reinstallStable()).rejects.toThrow("offline");
    expect(relaunch).not.toHaveBeenCalled();
  });
});
