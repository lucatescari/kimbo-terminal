import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { getAccountInfo, refreshAccount, clearAccountCacheForTesting } from "./claude-account";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => {
  invokeMock.mockReset();
  clearAccountCacheForTesting();
});

describe("getAccountInfo", () => {
  it("invokes claude_account_info with force_refresh: false", async () => {
    invokeMock.mockResolvedValueOnce({ logged_in: true, email: "a@b.c", subscription_type: "max" });
    await getAccountInfo();
    expect(invokeMock).toHaveBeenCalledWith("claude_account_info", { forceRefresh: false });
  });

  it("returns the parsed AccountInfo", async () => {
    invokeMock.mockResolvedValueOnce({ logged_in: true, email: "a@b.c", subscription_type: "max" });
    const got = await getAccountInfo();
    expect(got).toEqual({ logged_in: true, email: "a@b.c", subscription_type: "max" });
  });

  it("caches the result so subsequent calls don't reinvoke", async () => {
    invokeMock.mockResolvedValueOnce({ logged_in: true, email: "a@b.c", subscription_type: null });
    await getAccountInfo();
    await getAccountInfo();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("returns null and swallows errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getAccountInfo()).toBeNull();
    warn.mockRestore();
  });
});

describe("refreshAccount", () => {
  it("invokes claude_account_info with force_refresh: true and updates cache", async () => {
    invokeMock.mockResolvedValueOnce({ logged_in: true, email: "old@x.com", subscription_type: null });
    await getAccountInfo();
    invokeMock.mockResolvedValueOnce({ logged_in: true, email: "new@x.com", subscription_type: "pro" });
    const refreshed = await refreshAccount();
    expect(refreshed).toEqual({ logged_in: true, email: "new@x.com", subscription_type: "pro" });
    // Subsequent getAccountInfo returns the new value without re-invoking.
    invokeMock.mockClear();
    expect(await getAccountInfo()).toEqual({ logged_in: true, email: "new@x.com", subscription_type: "pro" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
