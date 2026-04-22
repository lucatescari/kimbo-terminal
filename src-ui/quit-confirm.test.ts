import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock factories hoist above top-level code, so shared state has to be
// declared inside vi.hoisted() (also hoisted) rather than as plain `let`.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  ptyIsBusy: vi.fn().mockResolvedValue(false),
  showDialog: vi.fn(),
  setPref: vi.fn(),
  prefs: { confirmQuit: true },
  panes: [] as Array<{ tabName: string; ptyId: number }>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./pty", () => ({ ptyIsBusy: mocks.ptyIsBusy }));
vi.mock("./quit-dialog", () => ({ showQuitDialog: mocks.showDialog }));
vi.mock("./ui-prefs", () => ({
  getPrefs: () => mocks.prefs,
  setPref: mocks.setPref,
}));
vi.mock("./tabs", () => ({
  collectOpenPanes: () => mocks.panes,
}));

import { confirmAndQuit, __resetQuittingForTests } from "./quit-confirm";

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.ptyIsBusy.mockReset().mockResolvedValue(false);
  mocks.showDialog.mockReset();
  mocks.setPref.mockReset();
  mocks.prefs.confirmQuit = true;
  mocks.panes = [{ tabName: "~", ptyId: 1 }];
  __resetQuittingForTests();
});

describe("confirmAndQuit: pref is off", () => {
  it("quits silently regardless of busy panes", async () => {
    mocks.prefs.confirmQuit = false;
    mocks.panes = [{ tabName: "~", ptyId: 1 }, { tabName: "dev", ptyId: 2 }];
    mocks.ptyIsBusy.mockResolvedValue(true); // every pane is busy
    const result = await confirmAndQuit();
    expect(result).toBe(true);
    expect(mocks.showDialog).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("quit_app");
  });
});

describe("confirmAndQuit: pref is on but no pane is busy", () => {
  it("skips the dialog when every pane is at an idle prompt", async () => {
    mocks.panes = [{ tabName: "~", ptyId: 1 }, { tabName: "b", ptyId: 2 }];
    mocks.ptyIsBusy.mockResolvedValue(false);
    const result = await confirmAndQuit();
    expect(result).toBe(true);
    expect(mocks.showDialog).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("quit_app");
  });

  it("still works when there are zero panes (edge case)", async () => {
    mocks.panes = [];
    await confirmAndQuit();
    expect(mocks.invoke).toHaveBeenCalledWith("quit_app");
  });
});

describe("confirmAndQuit: pref is on and at least one pane is busy", () => {
  it("shows the custom dialog listing busy panes, quits on confirm", async () => {
    mocks.panes = [{ tabName: "web", ptyId: 1 }, { tabName: "api", ptyId: 2 }];
    // Only pane 2 is busy.
    mocks.ptyIsBusy.mockImplementation(async (id: number) => id === 2);
    mocks.showDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    const result = await confirmAndQuit();
    expect(result).toBe(true);
    expect(mocks.showDialog).toHaveBeenCalledOnce();
    const [bodyText] = mocks.showDialog.mock.calls[0];
    expect(bodyText).toContain("api"); // only the busy tab, not "web"
    expect(bodyText).not.toContain("web");
    expect(mocks.invoke).toHaveBeenCalledWith("quit_app");
  });

  it("summary pluralises when multiple panes in one tab are busy", async () => {
    mocks.panes = [
      { tabName: "dev", ptyId: 1 },
      { tabName: "dev", ptyId: 2 },
      { tabName: "dev", ptyId: 3 },
    ];
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    await confirmAndQuit();
    const [body] = mocks.showDialog.mock.calls[0];
    expect(body).toMatch(/3 panes are still running in dev/);
  });

  it("user cancel returns false, does NOT quit, leaves pref untouched", async () => {
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showDialog.mockResolvedValueOnce({ confirmed: false, dontAskAgain: false });
    const result = await confirmAndQuit();
    expect(result).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.setPref).not.toHaveBeenCalled();
  });
});

describe("confirmAndQuit: don't-ask-again flag", () => {
  it("ticking the checkbox persists confirmQuit=false AND quits on confirm", async () => {
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: true });
    await confirmAndQuit();
    expect(mocks.setPref).toHaveBeenCalledWith("confirmQuit", false);
    expect(mocks.invoke).toHaveBeenCalledWith("quit_app");
  });

  it("ticking the checkbox AND cancelling still disables future prompts", async () => {
    // User wanted to cancel this quit but never be asked again in future —
    // we should respect both: no quit now, pref off for next time.
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showDialog.mockResolvedValueOnce({ confirmed: false, dontAskAgain: true });
    const result = await confirmAndQuit();
    expect(result).toBe(false);
    expect(mocks.setPref).toHaveBeenCalledWith("confirmQuit", false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("confirmAndQuit: reentrancy", () => {
  it("a second call while already quitting is a no-op but reports success", async () => {
    mocks.prefs.confirmQuit = false; // skip dialog, hit triggerQuit
    await confirmAndQuit();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    // Simulate the CloseRequested echo: rust sees app.exit() closing the
    // window, fires CloseRequested → quit-requested → confirmAndQuit. We
    // must not invoke quit_app a second time.
    const result2 = await confirmAndQuit();
    expect(result2).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.showDialog).not.toHaveBeenCalled();
  });
});

describe("confirmAndQuit: ptyIsBusy failures don't wedge the flow", () => {
  it("treats a rejected busy-check as false (skip confirm, quit)", async () => {
    mocks.panes = [{ tabName: "a", ptyId: 1 }, { tabName: "b", ptyId: 2 }];
    mocks.ptyIsBusy.mockRejectedValue(new Error("PTY closed"));
    const result = await confirmAndQuit();
    expect(result).toBe(true);
    expect(mocks.showDialog).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("quit_app");
  });
});
