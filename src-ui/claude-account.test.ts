import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { getAccountInfo, refreshAccount } from "./claude-account";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => {
  invokeMock.mockReset();
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

  it("queries the backend on every call (caching/invalidation is the backend's job)", async () => {
    invokeMock.mockResolvedValue({ logged_in: true, email: "a@b.c", subscription_type: null });
    await getAccountInfo();
    await getAccountInfo();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("returns null and swallows errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getAccountInfo()).toBeNull();
    warn.mockRestore();
  });

  // Regression for issue #9: after the user logs out and back in as a
  // different account, the top-bar email must update. The HUD polls
  // getAccountInfo() every 2s; if it short-circuits on a module-level
  // cache it keeps reporting the previous user forever (until restart).
  it("reflects an account change on a later call (no permanent stale cache)", async () => {
    invokeMock.mockResolvedValue({ logged_in: true, email: "userA@x.com", subscription_type: "max" });
    expect((await getAccountInfo())?.email).toBe("userA@x.com");

    // User logs out and logs in as a different account; the backend now
    // reports userB. A subsequent poll must surface userB, not userA.
    invokeMock.mockResolvedValue({ logged_in: true, email: "userB@x.com", subscription_type: "pro" });
    expect((await getAccountInfo())?.email).toBe("userB@x.com");
  });
});

describe("refreshAccount", () => {
  it("invokes claude_account_info with force_refresh: true", async () => {
    invokeMock.mockResolvedValueOnce({ logged_in: true, email: "new@x.com", subscription_type: "pro" });
    const refreshed = await refreshAccount();
    expect(invokeMock).toHaveBeenCalledWith("claude_account_info", { forceRefresh: true });
    expect(refreshed).toEqual({ logged_in: true, email: "new@x.com", subscription_type: "pro" });
  });

  it("returns null and swallows errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await refreshAccount()).toBeNull();
    warn.mockRestore();
  });
});
