import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeActiveOrTab: vi.fn(),
  closeTab: vi.fn(),
  getActiveSession: vi.fn(),
  getActiveTab: vi.fn(),
  getTree: vi.fn(),
  ptyIsBusy: vi.fn().mockResolvedValue(false),
  showConfirmDialog: vi.fn(),
  setPref: vi.fn(),
  prefs: { confirmQuit: true } as { confirmQuit: boolean },
}));

vi.mock("./tabs", () => ({
  closeActiveOrTab: mocks.closeActiveOrTab,
  closeTab: mocks.closeTab,
  getActiveSession: () => mocks.getActiveSession(),
  getActiveTab: () => mocks.getActiveTab(),
  getTree: () => mocks.getTree(),
}));
vi.mock("./pty", () => ({ ptyIsBusy: mocks.ptyIsBusy }));
vi.mock("./ui-prefs", () => ({
  getPrefs: () => mocks.prefs,
  setPref: mocks.setPref,
}));
vi.mock("./quit-dialog", () => ({ showConfirmDialog: mocks.showConfirmDialog }));

import { confirmAndCloseActive, confirmAndCloseActiveTab } from "./close-confirm";

beforeEach(() => {
  mocks.closeActiveOrTab.mockClear();
  mocks.closeTab.mockClear();
  mocks.getActiveSession.mockReset();
  mocks.getActiveTab.mockReset();
  mocks.getTree.mockReset();
  mocks.ptyIsBusy.mockReset().mockResolvedValue(false);
  mocks.showConfirmDialog.mockReset();
  mocks.setPref.mockReset();
  mocks.prefs.confirmQuit = true;
});

// -----------------------------------------------------------------------
// confirmAndCloseActive — ⌘W on a single pane or split
// -----------------------------------------------------------------------

describe("confirmAndCloseActive: pref off → always close silently", () => {
  it("closes without dialog even when the pane is busy", async () => {
    mocks.prefs.confirmQuit = false;
    mocks.getActiveSession.mockReturnValue({ ptyId: 7 });
    mocks.ptyIsBusy.mockResolvedValue(true);
    const result = await confirmAndCloseActive();
    expect(result).toBe(true);
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.closeActiveOrTab).toHaveBeenCalledOnce();
  });
});

describe("confirmAndCloseActive: no active session → just close", () => {
  it("skips the busy check when getActiveSession returns undefined", async () => {
    mocks.getActiveSession.mockReturnValue(undefined);
    await confirmAndCloseActive();
    expect(mocks.ptyIsBusy).not.toHaveBeenCalled();
    expect(mocks.closeActiveOrTab).toHaveBeenCalledOnce();
  });
});

describe("confirmAndCloseActive: pane is idle → close without dialog", () => {
  it("ptyIsBusy=false skips the dialog", async () => {
    mocks.getActiveSession.mockReturnValue({ ptyId: 3 });
    mocks.ptyIsBusy.mockResolvedValue(false);
    await confirmAndCloseActive();
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.closeActiveOrTab).toHaveBeenCalledOnce();
  });

  it("ptyIsBusy rejecting counts as idle (don't wedge the flow)", async () => {
    mocks.getActiveSession.mockReturnValue({ ptyId: 3 });
    mocks.ptyIsBusy.mockRejectedValue(new Error("PTY closed"));
    await confirmAndCloseActive();
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.closeActiveOrTab).toHaveBeenCalledOnce();
  });
});

describe("confirmAndCloseActive: pane is busy", () => {
  it("shows the dialog, closes on confirm", async () => {
    mocks.getActiveSession.mockReturnValue({ ptyId: 3 });
    mocks.getTree.mockReturnValue({ type: "split" });
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showConfirmDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    const result = await confirmAndCloseActive();
    expect(result).toBe(true);
    expect(mocks.showConfirmDialog).toHaveBeenCalledOnce();
    expect(mocks.closeActiveOrTab).toHaveBeenCalledOnce();
  });

  it("dialog title says 'Close pane' when inside a split, 'Close tab' when only one pane remains", async () => {
    mocks.getActiveSession.mockReturnValue({ ptyId: 3 });
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showConfirmDialog.mockResolvedValue({ confirmed: false, dontAskAgain: false });

    // Split tree → closing affects one pane only.
    mocks.getTree.mockReturnValue({ type: "split" });
    await confirmAndCloseActive();
    expect(mocks.showConfirmDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Close pane?" }),
    );

    // Single-leaf tree → this click closes the whole tab.
    mocks.getTree.mockReturnValue({ type: "leaf" });
    await confirmAndCloseActive();
    expect(mocks.showConfirmDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Close tab?" }),
    );
  });

  it("cancel → do NOT close, leave pref untouched", async () => {
    mocks.getActiveSession.mockReturnValue({ ptyId: 3 });
    mocks.getTree.mockReturnValue({ type: "split" });
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showConfirmDialog.mockResolvedValueOnce({ confirmed: false, dontAskAgain: false });
    const result = await confirmAndCloseActive();
    expect(result).toBe(false);
    expect(mocks.closeActiveOrTab).not.toHaveBeenCalled();
    expect(mocks.setPref).not.toHaveBeenCalled();
  });

  it("don't-ask-again persists confirmQuit=false", async () => {
    mocks.getActiveSession.mockReturnValue({ ptyId: 3 });
    mocks.getTree.mockReturnValue({ type: "split" });
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showConfirmDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: true });
    await confirmAndCloseActive();
    expect(mocks.setPref).toHaveBeenCalledWith("confirmQuit", false);
    expect(mocks.closeActiveOrTab).toHaveBeenCalledOnce();
  });
});

// -----------------------------------------------------------------------
// confirmAndCloseActiveTab — ⌘⇧W / menu "Close Tab"
// -----------------------------------------------------------------------

describe("confirmAndCloseActiveTab", () => {
  it("pref off → close silently", async () => {
    mocks.prefs.confirmQuit = false;
    mocks.getActiveTab.mockReturnValue({ id: 7 });
    mocks.getTree.mockReturnValue({
      type: "leaf",
      session: { ptyId: 1 },
    });
    mocks.ptyIsBusy.mockResolvedValue(true);
    await confirmAndCloseActiveTab();
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.closeTab).toHaveBeenCalledWith(7);
  });

  it("no busy panes → close silently", async () => {
    mocks.getActiveTab.mockReturnValue({ id: 7 });
    mocks.getTree.mockReturnValue({
      type: "split",
      first: { type: "leaf", session: { ptyId: 1 } },
      second: { type: "leaf", session: { ptyId: 2 } },
    });
    mocks.ptyIsBusy.mockResolvedValue(false);
    await confirmAndCloseActiveTab();
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.closeTab).toHaveBeenCalledWith(7);
  });

  it("one busy pane in a split → singular dialog body, close on confirm", async () => {
    mocks.getActiveTab.mockReturnValue({ id: 7 });
    mocks.getTree.mockReturnValue({
      type: "split",
      first: { type: "leaf", session: { ptyId: 1 } },
      second: { type: "leaf", session: { ptyId: 2 } },
    });
    mocks.ptyIsBusy.mockImplementation(async (id: number) => id === 2);
    mocks.showConfirmDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    await confirmAndCloseActiveTab();
    expect(mocks.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/A process is still running/),
      }),
    );
    expect(mocks.closeTab).toHaveBeenCalledWith(7);
  });

  it("multiple busy panes → pluralised dialog body", async () => {
    mocks.getActiveTab.mockReturnValue({ id: 7 });
    mocks.getTree.mockReturnValue({
      type: "split",
      first: { type: "leaf", session: { ptyId: 1 } },
      second: {
        type: "split",
        first: { type: "leaf", session: { ptyId: 2 } },
        second: { type: "leaf", session: { ptyId: 3 } },
      },
    });
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showConfirmDialog.mockResolvedValueOnce({ confirmed: true, dontAskAgain: false });
    await confirmAndCloseActiveTab();
    expect(mocks.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/3 panes/),
      }),
    );
  });

  it("cancel keeps the tab open; don't-ask-again still persists", async () => {
    mocks.getActiveTab.mockReturnValue({ id: 7 });
    mocks.getTree.mockReturnValue({
      type: "leaf",
      session: { ptyId: 1 },
    });
    mocks.ptyIsBusy.mockResolvedValue(true);
    mocks.showConfirmDialog.mockResolvedValueOnce({ confirmed: false, dontAskAgain: true });
    const result = await confirmAndCloseActiveTab();
    expect(result).toBe(false);
    expect(mocks.closeTab).not.toHaveBeenCalled();
    expect(mocks.setPref).toHaveBeenCalledWith("confirmQuit", false);
  });
});
