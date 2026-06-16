// @vitest-environment jsdom
//
// Regression tests for three settings-modal bugs reported by the user:
//
//   1. Clicking a sidebar nav item flashed the entire settings (visibly
//      closed and reopened). Root cause: render() did
//      overlayEl.innerHTML = "" on every nav click, recreating .settings
//      and replaying its `rise-in 0.22s` CSS animation. Fix: keep the
//      panel + sidebar refs alive and only refresh the .main content area
//      when the active category changes.
//
//   2. Settings opened twice on first launch (and sometimes on click).
//      Root cause: macOS native menu accelerators fire "menu-action" via
//      Tauri AND let the keydown reach the webview, so toggleSettings()
//      could be invoked twice in quick succession. With visible flipped
//      to true synchronously but overlay creation deferred behind an
//      `await invoke("get_config")`, the second call would call
//      hideSettings() before the first finished mounting — leaving the
//      modal visible while `visible === false`. Fix: re-entrancy guard
//      that releases on the next animation frame, same pattern as the
//      Cmd+W closeInFlight guard in tabs.ts.
//
//   3. The Advanced → "Open in editor" button did nothing. Root cause:
//      the handler invoked a non-existent `get_config_path` command,
//      caught the rejection, and fell back to openUrl("file:///tmp/...")
//      which is for URLs (browser), not files. Fix: a dedicated Rust
//      command `open_config_in_editor` that materializes the config
//      file and spawns the OS's default editor for it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const callLog: Array<{ kind: "invoke" | "listen"; name: string }> = [];
const invokeMock = vi.fn(async (cmd: string) => {
  callLog.push({ kind: "invoke", name: cmd });
  if (cmd === "get_config") return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (cmd === "list_unified_themes") return [];
  if (cmd === "get_config_path") return "/Users/test/.config/kimbo/config.toml";
  if (cmd === "open_config_in_editor") return undefined;
  if (cmd === "claude_notifications_status") return { kind: "NotInstalled" };
  return undefined;
});
type EventHandler<T> = (e: { payload: T }) => void;
const eventHandlers: Map<string, EventHandler<unknown>> = new Map();
const listenMock = vi.fn((event: string, handler: EventHandler<unknown>) => {
  callLog.push({ kind: "listen", name: event });
  eventHandlers.set(event, handler);
  return Promise.resolve(() => eventHandlers.delete(event));
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string])),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: EventHandler<unknown>) =>
    listenMock(event, handler),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));
vi.mock("./theme", () => ({
  applyTerminalOptions: vi.fn(),
  loadTheme: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./tabs", () => ({ fitAllPanes: vi.fn() }));
vi.mock("./kimbo-bus", () => ({ kimboBus: { emit: vi.fn() } }));
vi.mock("./kimbo", () => ({
  setKimboInConsoleView: vi.fn(),
  setKimboEnabled: vi.fn(),
  setKimboCorner: vi.fn(),
  setKimboShellIntegration: vi.fn(),
}));
vi.mock("./welcome-popup", () => ({ showWelcome: vi.fn() }));
vi.mock("./updates", () => ({
  getCachedUpdate: () => null,
  forceCheckUpdate: vi.fn(),
  hasPendingUpdate: () => false,
  downloadAndInstallUpdate: vi.fn(),
}));
vi.mock("./toast", () => ({
  showToast: vi.fn(),
}));
vi.mock("./platform", () => ({ isMacOS: () => true }));
vi.mock("./ui-prefs", () => ({
  getPrefs: () => ({
    density: "comfortable",
    tabStyle: "underline",
    accent: "",
    confirmQuit: true,
    startup: "last",
    backgroundOpacity: 100,
    transparentBlackBg: false,
    claudeHudEnabled: true,
    claudeHudExtended: false,
    claudeHudShowPlan: false,
    claudeRateLimitsEnabled: false,
    notifyOnStop: false,
    notifyOnPermission: false,
    notifySoundEnabled: false,
  }),
  setPref: vi.fn(),
  applyRoot: vi.fn(),
  clearPrefs: vi.fn(),
}));

import {
  openSettingsToCategory,
  hideSettings,
  toggleSettings,
  isSettingsVisible,
} from "./settings";
import { activeChord, actionForChord, resetOverrides } from "./keybindings";

const DEFAULT_CONFIG = {
  general: { default_shell: "/bin/zsh", default_layout: "single" },
  font: { family: "JetBrains Mono", size: 14, line_height: 1.2, ligatures: true },
  theme: { name: "kimbo-dark" },
  scrollback: { lines: 10000 },
  cursor: { style: "block", blink: true },
  keybindings: { bindings: {} },
  telemetry: { enabled: false },
  workspace: { auto_detect: true, scan_dirs: [] },
  kimbo: { enabled: true, corner: "bottom_right", shell_integration: false },
  updates: { auto_check: true },
  welcome: { show_on_startup: false },
};

beforeEach(async () => {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  host.id = "modal-root";
  document.body.appendChild(host);
  callLog.length = 0;
  invokeMock.mockClear();
  listenMock.mockClear();
  eventHandlers.clear();
  // settings.ts releases its toggleInFlight guard on requestAnimationFrame.
  // Without draining a pending rAF here, a re-entrancy test from a prior
  // case leaves the flag set and the next case's first toggleSettings()
  // returns immediately without doing anything.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
});

afterEach(() => {
  hideSettings();
});

// ---------------------------------------------------------------------------
// Bug 1: no flash on nav click
// ---------------------------------------------------------------------------

describe("settings: no-flash on sidebar nav click", () => {
  it("clicking a different sidebar nav item keeps the same .settings panel element", async () => {
    await openSettingsToCategory("general");
    const panelBefore = document.querySelector<HTMLElement>(".modal-overlay .settings");
    const sideBefore = document.querySelector<HTMLElement>(".modal-overlay .settings .side");
    expect(panelBefore).not.toBeNull();
    expect(sideBefore).not.toBeNull();

    const advBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .side .nav"),
    ).find((b) => b.dataset.navId === "advanced");
    expect(advBtn, "advanced nav button must exist").not.toBeUndefined();
    advBtn!.click();

    const panelAfter = document.querySelector<HTMLElement>(".modal-overlay .settings");
    const sideAfter = document.querySelector<HTMLElement>(".modal-overlay .settings .side");
    // Same DOM nodes — no recreation, no animation replay.
    expect(panelAfter).toBe(panelBefore);
    expect(sideAfter).toBe(sideBefore);
  });

  it("clicking a different sidebar nav item swaps in the new section's content", async () => {
    await openSettingsToCategory("general");
    expect(document.querySelector(".modal-overlay .settings .main h1")?.textContent)
      .toBe("General");

    const advBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .side .nav"),
    ).find((b) => b.dataset.navId === "advanced")!;
    advBtn.click();

    expect(document.querySelector(".modal-overlay .settings .main h1")?.textContent)
      .toBe("Advanced");
  });

  it("clicking the active sidebar nav item is a no-op (no re-render thrash)", async () => {
    await openSettingsToCategory("general");
    const mainBefore = document.querySelector<HTMLElement>(".modal-overlay .settings .main")!;
    const firstChildBefore = mainBefore.firstElementChild;

    const generalBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .side .nav"),
    ).find((b) => b.dataset.navId === "general")!;
    generalBtn.click();

    const mainAfter = document.querySelector<HTMLElement>(".modal-overlay .settings .main")!;
    expect(mainAfter).toBe(mainBefore);
    expect(mainAfter.firstElementChild).toBe(firstChildBefore);
  });

  it("the active class moves between nav buttons without rebuilding the sidebar", async () => {
    await openSettingsToCategory("general");
    const generalBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .side .nav"),
    ).find((b) => b.dataset.navId === "general")!;
    const advBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .side .nav"),
    ).find((b) => b.dataset.navId === "advanced")!;
    expect(generalBtn.classList.contains("active")).toBe(true);
    expect(advBtn.classList.contains("active")).toBe(false);

    advBtn.click();

    expect(generalBtn.classList.contains("active")).toBe(false);
    expect(advBtn.classList.contains("active")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 2: re-entrancy guard on toggleSettings
// ---------------------------------------------------------------------------

describe("settings: toggleSettings re-entrancy", () => {
  it("two rapid toggleSettings calls only open the modal once and leave consistent state", async () => {
    // Simulate the macOS double-dispatch: menu-action listener and keydown
    // handler both fire toggleSettings within the same tick. Without the
    // guard, call 1 enters showSettings (visible=true, awaits get_config)
    // and call 2 sees visible=true and runs hideSettings — the eventual
    // mount lands with visible=false and one stray modal in the DOM.
    const p1 = toggleSettings();
    const p2 = toggleSettings();
    await Promise.all([p1, p2]);

    const overlays = document.querySelectorAll(".modal-overlay");
    expect(overlays.length).toBe(1);
    expect(isSettingsVisible()).toBe(true);
  });

  it("a second toggle on the next frame still toggles (guard releases)", async () => {
    const p1 = toggleSettings();
    const p2 = toggleSettings();
    await Promise.all([p1, p2]);
    expect(isSettingsVisible()).toBe(true);

    await new Promise((r) => requestAnimationFrame(() => r(null)));

    await toggleSettings();
    expect(isSettingsVisible()).toBe(false);
    expect(document.querySelectorAll(".modal-overlay").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 3: Advanced → Open in editor
// ---------------------------------------------------------------------------

describe("settings: Advanced → Open in editor", () => {
  it("clicking 'Open in editor' invokes the open_config_in_editor command", async () => {
    await openSettingsToCategory("advanced");
    const btn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .main button.btn"),
    ).find((b) => b.textContent?.trim() === "Open in editor");
    expect(btn, "'Open in editor' button must exist").not.toBeUndefined();

    invokeMock.mockClear();
    btn!.click();
    // Let the click handler's awaited invoke settle.
    await Promise.resolve();
    await Promise.resolve();

    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain("open_config_in_editor");
  });
});

// ---------------------------------------------------------------------------
// Cleanup: unimplemented keymap buttons removed
// ---------------------------------------------------------------------------

describe("settings: Keybinds rebinding", () => {
  beforeEach(() => resetOverrides());

  const chipFor = (id: string) =>
    document.querySelector<HTMLButtonElement>(`.modal-overlay .settings .main .krow[data-action-id="${id}"]`);

  function pressChord(init: KeyboardEventInit): void {
    document.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
  }

  it("captures a new chord for a webview action and persists it", async () => {
    await openSettingsToCategory("keybinds");
    const chip = chipFor("command_palette");
    expect(chip, "command_palette chip rendered").not.toBeNull();

    chip!.click();
    invokeMock.mockClear();
    pressChord({ key: "j", metaKey: true, altKey: true }); // ⌘⌥J

    expect(activeChord("command_palette")).toBe("cmd-alt-j");
    expect(actionForChord("cmd-alt-j")).toBe("command_palette");
    expect(invokeMock.mock.calls.some((c) => c[0] === "save_config")).toBe(true);
  });

  it("rebinding a MENU action pushes the new accelerator to the native menu", async () => {
    await openSettingsToCategory("keybinds");
    chipFor("split_horizontal")!.click();
    invokeMock.mockClear();
    pressChord({ key: "e", metaKey: true, altKey: true }); // ⌘⌥E

    expect(activeChord("split_horizontal")).toBe("cmd-alt-e");
    // The menu-owned path must update the native accelerator via Rust.
    const call = invokeMock.mock.calls.find((c) => c[0] === "set_menu_accelerator") as unknown[] | undefined;
    expect(call, "set_menu_accelerator invoked for a menu action").toBeTruthy();
    expect(call![1]).toMatchObject({ id: "split_horizontal", chord: "cmd-alt-e" });
  });

  it("rejects a chord already bound to another action", async () => {
    await openSettingsToCategory("keybinds");
    chipFor("command_palette")!.click();
    pressChord({ key: "w", metaKey: true }); // ⌘W is close_pane
    expect(activeChord("command_palette")).toBe("cmd-k"); // unchanged
  });

  it("Reset to defaults clears overrides and restores menu accelerators", async () => {
    await openSettingsToCategory("keybinds");
    chipFor("split_horizontal")!.click();
    pressChord({ key: "e", metaKey: true, altKey: true });
    expect(activeChord("split_horizontal")).toBe("cmd-alt-e");

    const reset = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .main button"),
    ).find((b) => b.textContent?.trim() === "Reset to defaults");
    expect(reset, "reset button rendered").not.toBeUndefined();
    reset!.click();
    expect(activeChord("split_horizontal")).toBe("cmd-shift-d");
  });
});

// ---------------------------------------------------------------------------
// Bug 4: settings "popped in twice" on first open (cold theme cache)
// ---------------------------------------------------------------------------
//
// Distinct from Bug 2, which was a double *dispatch* of toggleSettings. Here a
// SINGLE open rendered twice: showSettings() mounts .settings (render #1,
// playing `rise-in`), then the async theme load — on a COLD cache, where the
// `themes://community-ready` event hasn't fired yet — called the FULL render()
// again, doing overlayEl.innerHTML = "" and recreating .settings, which
// replays `rise-in`. The user sees the panel pop in a second time. A warm
// cache hid it: the community event resolved first and skipped the post-load
// render. Fix: refresh themes in place via renderActive() — the same
// no-replay path nav clicks already use (Bug 1) — instead of full render().

describe("settings: no double-pop on first open (cold theme cache)", () => {
  it("keeps the same .settings panel element across the post-load theme refresh", async () => {
    // Defer list_unified_themes so we can observe the panel AFTER the initial
    // render but BEFORE the post-load refresh — the exact window in which the
    // bug recreated .settings. No community-ready event fires (cold cache).
    let resolveThemes: (v: unknown[]) => void = () => {};
    const themesDeferred = new Promise<unknown[]>((r) => { resolveThemes = r; });
    const originalImpl = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_unified_themes") return themesDeferred;
      return originalImpl(cmd);
    });

    try {
      const open = openSettingsToCategory("appearance");

      // Let get_config + listen resolve so render #1 mounts .settings; we then
      // park on the deferred list_unified_themes await.
      let panelBefore: HTMLElement | null = null;
      for (let i = 0; i < 20 && !panelBefore; i++) {
        await Promise.resolve();
        panelBefore = document.querySelector<HTMLElement>(".modal-overlay .settings");
      }
      expect(panelBefore, "panel mounts on the initial render").not.toBeNull();

      // Release the theme list → triggers the post-load refresh.
      resolveThemes([]);
      await open;

      const panelAfter = document.querySelector<HTMLElement>(".modal-overlay .settings");
      // Same node = refreshed in place, `rise-in` not replayed.
      expect(panelAfter).toBe(panelBefore);
    } finally {
      invokeMock.mockImplementation(originalImpl);
    }
  });
});

// ---------------------------------------------------------------------------
// Advanced → Reset all settings (replaces the old "coming soon" stub)
// ---------------------------------------------------------------------------

describe("settings: Advanced → Reset all settings", () => {
  function findResetBtn(): HTMLButtonElement | undefined {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(".modal-overlay .settings .main button"),
    ).find((b) => b.textContent?.trim().startsWith("Reset"));
  }

  function stubReload(): ReturnType<typeof vi.fn> {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    return reload;
  }

  it("on confirm: resets config, clears UI prefs, and reloads", async () => {
    const { clearPrefs } = await import("./ui-prefs");
    vi.mocked(clearPrefs).mockClear();
    const reload = stubReload();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    await openSettingsToCategory("advanced");
    const reset = findResetBtn();
    expect(reset, "reset button is rendered").not.toBeUndefined();

    reset!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("reset_config");
    expect(vi.mocked(clearPrefs)).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("on cancel: does nothing (no reset, no reload)", async () => {
    const reload = stubReload();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await openSettingsToCategory("advanced");
    const reset = findResetBtn()!;
    invokeMock.mockClear();
    reset.click();
    await Promise.resolve();

    expect(invokeMock).not.toHaveBeenCalledWith("reset_config");
    expect(reload).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
