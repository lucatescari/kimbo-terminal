// @vitest-environment jsdom
//
// Tests the modal-overlay wiring for settings:
//
//   1. The blurred backdrop is a Tauri drag region (data-tauri-drag-region)
//      so the user can move the window by grabbing the blur around the panel.
//      CSS -webkit-app-region: drag is unreliable with backdrop-filter on
//      WKWebView — data-tauri-drag-region is the pattern that already works
//      for the title bar (see title-bar.test.ts) and is what the Tauri ACL
//      is set up for (core:window:allow-start-dragging).
//
//   2. The inner .settings panel does NOT carry the drag attribute, so
//      clicks on controls still land.
//
//   3. The themes://community-ready listener is registered BEFORE
//      invoke('list_unified_themes'). The backend spawns a background task
//      on that invoke which can emit the event before the frontend await
//      resumes. If the listener is registered after, fast (cache-hit)
//      emits can be lost and the gallery is stuck on "Loading community
//      themes…" forever.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { UnifiedTheme } from "./settings-types";

// ----------------------------------------------------------------------------
// Mocks — replicate the setup from settings-themes.test.ts so settings.ts
// can be imported with all its dependencies stubbed.
// ----------------------------------------------------------------------------

// Track ordered invoke + listen calls so we can assert registration order.
const callLog: Array<{ kind: "invoke" | "listen"; name: string }> = [];
const invokeMock = vi.fn(async (cmd: string) => {
  callLog.push({ kind: "invoke", name: cmd });
  if (cmd === "get_config") return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (cmd === "list_unified_themes") return [];
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
const platformState = vi.hoisted(() => ({ isMacOS: true }));

vi.mock("./platform", () => ({
  isMacOS: () => platformState.isMacOS,
}));

vi.mock("./ui-prefs", () => ({
  getPrefs: () => ({
    density: "comfortable",
    tabStyle: "underline",
    accent: "",
    confirmQuit: true,
    startup: "last",
    windowChrome: "native",
    newWindowPosition: "last",
    backgroundOpacity: 100,
    fontSmoothing: "subpixel",
    gpuRendering: true,
    flushIntervalMs: 16,
    telemetry: false,
    releaseChannel: "stable",
  }),
  setPref: vi.fn(),
  applyRoot: vi.fn(),
}));

import { openSettingsToCategory, hideSettings } from "./settings";

const DEFAULT_CONFIG = {
  general: { default_shell: "/bin/zsh", default_layout: "single" },
  font: { family: "JetBrains Mono", size: 14, line_height: 1.2, ligatures: true },
  theme: { name: "kimbo-dark" },
  scrollback: { lines: 10000 },
  cursor: { style: "block", blink: true },
  keybindings: { bindings: {} },
  workspace: { auto_detect: true, scan_dirs: [] },
  kimbo: { enabled: true, corner: "bottom_right", shell_integration: false },
  updates: { auto_check: true },
  welcome: { show_on_startup: false },
};

beforeEach(() => {
  document.body.innerHTML = "";
  // Provide the #modal-root host the production DOM uses.
  const host = document.createElement("div");
  host.id = "modal-root";
  document.body.appendChild(host);
  callLog.length = 0;
  invokeMock.mockClear();
  listenMock.mockClear();
  eventHandlers.clear();
});

afterEach(() => {
  hideSettings();
});

// ----------------------------------------------------------------------------
// Drag region
// ----------------------------------------------------------------------------

describe("settings modal: backdrop is a Tauri drag region", () => {
  it("the .modal-overlay carries data-tauri-drag-region so the blurred area drags the window", async () => {
    await openSettingsToCategory("appearance");
    const overlay = document.querySelector<HTMLElement>(".modal-overlay")!;
    expect(overlay).not.toBeNull();
    expect(overlay.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("the inner .settings panel does NOT carry data-tauri-drag-region (so controls stay clickable)", async () => {
    await openSettingsToCategory("appearance");
    const panel = document.querySelector<HTMLElement>(".modal-overlay .settings")!;
    expect(panel).not.toBeNull();
    expect(panel.hasAttribute("data-tauri-drag-region")).toBe(false);
  });
});

describe("settings modal: drag vs click on the backdrop", () => {
  // Tauri's window drag completes as a mousedown/mouseup pair that also
  // fires a synthetic click on the backdrop. Without discrimination, any
  // drag of the window via the blurred area would close the settings —
  // the user asked for drag to keep the modal open, and only a genuine
  // click (no movement) to close it.

  /** A genuine click — pointer didn't move between down and up. Both client
   *  and screen coords are identical. */
  function dispatchClick(el: HTMLElement, clientX: number, clientY: number, screenX: number, screenY: number): void {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX, clientY, screenX, screenY }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, clientX, clientY, screenX, screenY }));
    el.dispatchEvent(new MouseEvent("click",     { bubbles: true, clientX, clientY, screenX, screenY }));
  }

  /** A Tauri window drag — reviewing tauri-2.10.3/src/window/scripts/drag.js:
   *  on mousedown the native window drag starts and the window follows the
   *  pointer. Because of that, clientX/clientY stay PINNED relative to the
   *  window while only screenX/screenY track the actual pointer movement.
   *  After the drag ends, a click event fires at the same clientX/clientY as
   *  the original mousedown. Any solution that inspects only clientX/clientY
   *  will see zero movement and close the modal by mistake. */
  function dispatchWindowDrag(
    el: HTMLElement,
    clientX: number, clientY: number,
    fromScreenX: number, fromScreenY: number,
    toScreenX: number, toScreenY: number,
  ): void {
    el.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, clientX, clientY, screenX: fromScreenX, screenY: fromScreenY,
    }));
    el.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, clientX, clientY, screenX: toScreenX, screenY: toScreenY,
    }));
    el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, clientX, clientY, screenX: toScreenX, screenY: toScreenY,
    }));
  }

  it("a genuine click on the blurred backdrop still closes the settings", async () => {
    await openSettingsToCategory("appearance");
    const overlay = document.querySelector<HTMLElement>(".modal-overlay")!;
    dispatchClick(overlay, 10, 10, 110, 210);
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("a Tauri window drag (clientXY constant, screenXY moves) does NOT close the settings", async () => {
    await openSettingsToCategory("appearance");
    const overlay = document.querySelector<HTMLElement>(".modal-overlay")!;
    dispatchWindowDrag(overlay, 50, 50, /*from screen*/ 500, 500, /*to screen*/ 700, 650);
    // Modal must still be mounted — the window moved, the modal stays.
    expect(document.querySelector(".modal-overlay")).not.toBeNull();
  });

  it("a tiny jitter under the drag threshold still counts as a click", async () => {
    // People don't click with perfectly still pointers. 1-2px of noise has
    // to still close the modal, otherwise clicks feel unresponsive.
    await openSettingsToCategory("appearance");
    const overlay = document.querySelector<HTMLElement>(".modal-overlay")!;
    dispatchWindowDrag(overlay, 100, 100, /*from*/ 500, 500, /*to*/ 501, 502);
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Listener race — community-ready listener must be attached BEFORE the
// list_unified_themes invoke that kicks off the backend emit.
// ----------------------------------------------------------------------------

describe("settings modal: community-ready listener race", () => {
  it("listen('themes://community-ready') is registered before invoke('list_unified_themes')", async () => {
    await openSettingsToCategory("appearance");

    const listenIdx = callLog.findIndex(
      (c) => c.kind === "listen" && c.name === "themes://community-ready",
    );
    const invokeIdx = callLog.findIndex(
      (c) => c.kind === "invoke" && c.name === "list_unified_themes",
    );

    expect(listenIdx, "listen for themes://community-ready must be called").toBeGreaterThanOrEqual(0);
    expect(invokeIdx, "invoke list_unified_themes must be called").toBeGreaterThanOrEqual(0);
    expect(
      listenIdx,
      "listen must happen BEFORE invoke so the backend emit cannot be lost",
    ).toBeLessThan(invokeIdx);
  });

  it("event fired immediately after list_unified_themes is received (listener already live)", async () => {
    // Simulate a warm-cache backend: the moment list_unified_themes is
    // invoked, the Rust-spawned task emits themes://community-ready right
    // away. If the listener isn't attached yet, the UI stays stuck on
    // "Loading community themes…".
    const tokyo: UnifiedTheme = {
      slug: "tokyo-night",
      name: "Tokyo Night",
      theme_type: "dark",
      author: "enkia",
      version: "1.0.0",
      swatches: { background: "#1a1b26", foreground: "#c0caf5", accent: "#7aa2f7", cursor: "#c0caf5" },
      source: "Available",
      active: false,
    };

    invokeMock.mockImplementation(async (cmd: string) => {
      callLog.push({ kind: "invoke", name: cmd });
      if (cmd === "get_config") return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (cmd === "list_unified_themes") {
        // Backend pattern: list_unified_themes returns immediately, but the
        // spawned task also emits the community-ready event. Fire that
        // emit SYNCHRONOUSLY from inside the invoke mock to simulate the
        // tightest possible race with the listener.
        queueMicrotask(() => {
          const handler = eventHandlers.get("themes://community-ready");
          if (handler) {
            handler({
              payload: {
                themes: [tokyo],
                community_catalog_size: 1,
                community_resolved: true,
              },
            });
          }
        });
        return [];
      }
      return undefined;
    });

    await openSettingsToCategory("appearance");
    // Let the queued microtask run.
    await Promise.resolve();
    await Promise.resolve();

    // Gallery shows tokyo-night card, NOT "Loading community themes…".
    const gallery = document.querySelector<HTMLElement>(".settings .main .gallery");
    expect(gallery, "gallery must render").not.toBeNull();
    expect(gallery!.textContent).not.toContain("Loading community themes");
    expect(gallery!.querySelector<HTMLElement>('.theme-card[data-slug="tokyo-night"]'))
      .not.toBeNull();
  });
});

describe("settings modal: Background opacity row", () => {
  beforeEach(() => { platformState.isMacOS = true; });
  afterEach(() => { platformState.isMacOS = true; });

  it("is enabled (no Coming-soon tag) on macOS", async () => {
    await openSettingsToCategory("general");
    const slider = document.querySelector<HTMLInputElement>(
      'input[type="range"][min="0"][max="100"]'
    );
    expect(slider).not.toBeNull();
    expect(slider!.style.pointerEvents).not.toBe("none");
    // Sibling "Coming soon" tag should not be attached to this slider's row.
    const row = slider!.closest(".row")!;
    expect(row.querySelector(".cs-tag")).toBeNull();
  });

  it("is disabled with Coming-soon tag on non-macOS", async () => {
    platformState.isMacOS = false;
    await openSettingsToCategory("general");
    const slider = document.querySelector<HTMLInputElement>(
      'input[type="range"][min="0"][max="100"]'
    );
    expect(slider).not.toBeNull();
    expect(slider!.style.pointerEvents).toBe("none");
    const wrap = slider!.parentElement!;
    expect(wrap.querySelector(".cs-tag")).not.toBeNull();
  });
});
