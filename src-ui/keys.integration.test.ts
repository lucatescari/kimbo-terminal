// @vitest-environment jsdom
//
// End-to-end test of the REAL keys.ts dispatch path. The webview owns ONLY the
// non-menu shortcuts; the menu-owned ones (split, new tab, close, quit, …) are
// handled by the native macOS menu and must NOT fire from the webview (that
// double-dispatch / hijack is what broke the first attempt). This dispatches
// real KeyboardEvents through initKeys and asserts both halves.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  tabs: {
    createTab: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
    switchToTab: vi.fn(),
    splitActive: vi.fn(),
    focusDirection: vi.fn(),
    reopenLastClosedTab: vi.fn(),
  },
  settings: { isSettingsVisible: () => false, hideSettings: vi.fn() },
  findBar: { toggleFindBar: vi.fn(), isFindBarVisible: () => false, hideFindBar: vi.fn() },
  palette: {
    toggleCommandPalette: vi.fn(),
    toggleProjectsPalette: vi.fn(),
    isCommandPaletteVisible: () => false,
    hideCommandPalette: vi.fn(),
  },
}));
const { tabs, findBar, palette } = m;

vi.mock("./tabs", () => m.tabs);
vi.mock("./settings", () => m.settings);
vi.mock("./find-bar", () => m.findBar);
vi.mock("./command-palette", () => m.palette);

import { initKeys } from "./keys";

initKeys({});

function press(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  for (const fn of [
    ...Object.values(tabs), findBar.toggleFindBar,
    palette.toggleCommandPalette, palette.toggleProjectsPalette,
  ]) (fn as ReturnType<typeof vi.fn>).mockClear();
});

describe("keys.ts: webview-owned shortcuts dispatch", () => {
  it("Cmd+] → nextTab", () => {
    press({ key: "]", metaKey: true });
    expect(tabs.nextTab).toHaveBeenCalledTimes(1);
  });

  it("Cmd+[ → prevTab", () => {
    press({ key: "[", metaKey: true });
    expect(tabs.prevTab).toHaveBeenCalledTimes(1);
  });

  it("Cmd+ArrowUp → focusDirection('horizontal', false)", () => {
    press({ key: "ArrowUp", metaKey: true });
    expect(tabs.focusDirection).toHaveBeenCalledWith("horizontal", false);
  });

  it("Cmd+K → command palette", () => {
    press({ key: "k", metaKey: true });
    expect(palette.toggleCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("Cmd+O → projects palette", () => {
    press({ key: "o", metaKey: true });
    expect(palette.toggleProjectsPalette).toHaveBeenCalledTimes(1);
  });

  it("Cmd+F → find bar", () => {
    press({ key: "f", metaKey: true });
    expect(findBar.toggleFindBar).toHaveBeenCalledTimes(1);
  });

  it("Cmd+1 → switchToTab(0)", () => {
    press({ key: "1", metaKey: true });
    expect(tabs.switchToTab).toHaveBeenCalledWith(0);
  });
});

describe("keys.ts: menu-owned shortcuts are NOT handled by the webview", () => {
  // These belong to the native macOS menu; the webview must stay out of the way.
  it("Cmd+Shift+D does not splitActive from the webview", () => {
    press({ key: "D", metaKey: true, shiftKey: true });
    press({ key: "d", metaKey: true, shiftKey: true });
    expect(tabs.splitActive).not.toHaveBeenCalled();
  });

  it("Cmd+W does not close from the webview", () => {
    press({ key: "w", metaKey: true });
    // no webview handler for close_pane; nothing in tabs fires
    expect(tabs.createTab).not.toHaveBeenCalled();
    expect(tabs.splitActive).not.toHaveBeenCalled();
  });

  it("Cmd+T does not create a tab from the webview", () => {
    press({ key: "t", metaKey: true });
    expect(tabs.createTab).not.toHaveBeenCalled();
  });
});
