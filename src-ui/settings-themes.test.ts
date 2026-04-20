// @vitest-environment jsdom
//
// Integration tests for the theme install / uninstall flow in Settings →
// Appearance. These verify the contract the user actually relies on:
//
//   1. Installing a theme moves it OUT of the community gallery and INTO
//      the main grid (driven by the themes://community-ready event the
//      backend emits after install_theme).
//   2. Uninstalling a theme moves it BACK into the community gallery.
//   3. Clicking an Available card invokes the install_theme command.
//   4. Clicking the × twice on an Installed card invokes delete_theme.
//
// We mock the Tauri runtime so we can:
//   - inspect which commands the UI invokes
//   - manually fire the themes://community-ready event with controlled
//     payloads (proxying what the Rust backend would emit)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { UnifiedTheme } from "./settings-types";

// ----------------------------------------------------------------------------
// Mocks — set up before importing settings.ts so the imports resolve to them.
// ----------------------------------------------------------------------------

const invokeMock = vi.fn();
type EventHandler<T> = (e: { payload: T }) => void;
const eventHandlers: Map<string, EventHandler<unknown>> = new Map();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: EventHandler<unknown>) => {
    eventHandlers.set(event, handler);
    return Promise.resolve(() => eventHandlers.delete(event));
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./theme", () => ({
  applyTerminalOptions: vi.fn(),
  loadTheme: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./tabs", () => ({
  fitAllPanes: vi.fn(),
}));

vi.mock("./kimbo-bus", () => ({
  kimboBus: { emit: vi.fn() },
}));

vi.mock("./kimbo", () => ({
  setKimboInConsoleView: vi.fn(),
  setKimboEnabled: vi.fn(),
  setKimboCorner: vi.fn(),
  setKimboShellIntegration: vi.fn(),
}));

vi.mock("./welcome-popup", () => ({
  showWelcome: vi.fn(),
}));

vi.mock("./updates", () => ({
  getCachedUpdate: () => null,
  forceCheckUpdate: vi.fn(),
  hasPendingUpdate: () => false,
  downloadAndInstallUpdate: vi.fn(),
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

import { toggleSettings, hideSettings, openSettingsToCategory } from "./settings";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeTheme(overrides: Partial<UnifiedTheme> = {}): UnifiedTheme {
  return {
    slug: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    theme_type: "dark",
    author: "catppuccin",
    version: "1.0.0",
    swatches: { background: "#1e1e2e", foreground: "#cdd6f4", accent: "#cba6f7", cursor: "#f5e0dc" },
    source: "Available",
    active: false,
    ...overrides,
  };
}

const BUILTINS: UnifiedTheme[] = [
  makeTheme({ slug: "kimbo-dark", name: "Kimbo Dark", source: "Builtin" }),
  makeTheme({ slug: "kimbo-light", name: "Kimbo Light", theme_type: "light", source: "Builtin" }),
];

function payloadFor(themes: UnifiedTheme[], catalogSize: number) {
  return { themes, community_catalog_size: catalogSize, community_resolved: true };
}

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

/** Open the settings panel pre-loaded with the given theme list. Resolves
 *  once the appearance panel is rendered with the initial state. */
async function openWithThemes(themes: UnifiedTheme[], catalogSize: number) {
  invokeMock.mockImplementation(async (cmd: string) => {
    // Deep clone DEFAULT_CONFIG so the module's `config` is fresh per test —
    // the install/activate paths mutate config.theme.name, which leaks
    // between tests if we hand out the same reference each time.
    if (cmd === "get_config") return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (cmd === "list_unified_themes") return themes;
    if (cmd === "install_theme") return undefined;
    if (cmd === "delete_theme") return undefined;
    if (cmd === "save_config") return undefined;
    return undefined;
  });

  await openSettingsToCategory("appearance");

  // The listener was registered after list_unified_themes resolved. Fire the
  // initial themes://community-ready event so the panel transitions to
  // "fully resolved" state (otherwise the gallery shows "Loading…").
  emitThemesReady(themes, catalogSize);
}

/** Manually invoke the themes://community-ready listener — proxies what the
 *  Rust backend's emit_full_list would send. */
function emitThemesReady(themes: UnifiedTheme[], catalogSize: number) {
  const handler = eventHandlers.get("themes://community-ready");
  if (!handler) throw new Error("themes://community-ready listener not registered yet");
  handler({ payload: payloadFor(themes, catalogSize) });
}

function querySection(label: string): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>(".settings .main .section");
  for (const sec of panels) {
    if (sec.querySelector(".section-head")?.textContent === label) return sec;
  }
  return null;
}

function galleryCards(): NodeListOf<HTMLElement> {
  const gallery = document.querySelector<HTMLElement>(".settings .main .gallery");
  return gallery!.querySelectorAll<HTMLElement>(".theme-card");
}

function topGridCards(): NodeListOf<HTMLElement> {
  // The "Theme" section is the first section in the appearance panel.
  const panels = document.querySelectorAll<HTMLElement>(".settings .main .section");
  return panels[0].querySelectorAll<HTMLElement>(".theme-card");
}

// ----------------------------------------------------------------------------
// Setup
// ----------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = "";
  invokeMock.mockReset();
  eventHandlers.clear();
});

afterEach(() => {
  hideSettings();
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("settings: theme partitioning into Yours vs Community gallery", () => {
  it("renders Builtin + Installed in the Theme grid; Available in the gallery", async () => {
    const mocha = makeTheme({ slug: "catppuccin-mocha", source: "Installed" });
    const tokyo = makeTheme({ slug: "tokyo-night", name: "Tokyo Night", source: "Available" });
    const latte = makeTheme({ slug: "catppuccin-latte", name: "Catppuccin Latte", source: "Available" });

    await openWithThemes([...BUILTINS, mocha, tokyo, latte], 3);

    const top = [...topGridCards()].map((c) => c.dataset.slug);
    const gallery = [...galleryCards()].map((c) => c.dataset.slug);
    expect(top).toEqual(["kimbo-dark", "kimbo-light", "catppuccin-mocha"]);
    expect(gallery).toEqual(["tokyo-night", "catppuccin-latte"]);
  });

  it("when all community themes are installed, gallery shows the 'all installed' message (NOT 'offline')", async () => {
    const mocha = makeTheme({ slug: "catppuccin-mocha", source: "Installed" });
    const tokyo = makeTheme({ slug: "tokyo-night", source: "Installed" });

    await openWithThemes([...BUILTINS, mocha, tokyo], 2);

    const gallery = document.querySelector<HTMLElement>(".settings .main .gallery")!;
    expect(gallery.textContent).toContain("All 2 community themes are installed");
    expect(gallery.textContent).not.toContain("offline");
  });

  it("when fetch genuinely fails (catalog size 0), gallery shows the offline message", async () => {
    await openWithThemes([...BUILTINS], 0);

    const gallery = document.querySelector<HTMLElement>(".settings .main .gallery")!;
    expect(gallery.textContent).toContain("offline");
  });
});

describe("settings: install flow → theme moves into the main grid", () => {
  it("clicking an Available card invokes install_theme with that slug", async () => {
    const tokyo = makeTheme({ slug: "tokyo-night", name: "Tokyo Night", source: "Available" });

    await openWithThemes([...BUILTINS, tokyo], 1);

    const card = [...galleryCards()].find((c) => c.dataset.slug === "tokyo-night");
    expect(card, "tokyo-night card must be in the gallery").not.toBeUndefined();
    card!.click();

    // Wait a tick so the async onInstall callback runs.
    await Promise.resolve();
    await Promise.resolve();

    const installCall = invokeMock.mock.calls.find((c) => c[0] === "install_theme");
    expect(installCall, "install_theme must be invoked").not.toBeUndefined();
    expect(installCall![1]).toEqual({ slug: "tokyo-night", activeSlug: "kimbo-dark" });
  });

  it("after the backend emits the post-install event, the theme moves from gallery to main grid", async () => {
    const tokyo = makeTheme({ slug: "tokyo-night", name: "Tokyo Night", source: "Available" });
    await openWithThemes([...BUILTINS, tokyo], 1);

    // Sanity: starts in gallery, NOT in top grid.
    expect([...galleryCards()].map((c) => c.dataset.slug)).toContain("tokyo-night");
    expect([...topGridCards()].map((c) => c.dataset.slug)).not.toContain("tokyo-night");

    // Backend fires the updated event after install_theme finishes.
    const tokyoNowInstalled = makeTheme({ slug: "tokyo-night", name: "Tokyo Night", source: "Installed" });
    emitThemesReady([...BUILTINS, tokyoNowInstalled], 1);

    expect([...topGridCards()].map((c) => c.dataset.slug)).toContain("tokyo-night");
    expect([...galleryCards()].length).toBe(0);
    // Gallery now reads the "all installed" message.
    const gallery = document.querySelector<HTMLElement>(".settings .main .gallery")!;
    expect(gallery.textContent).toContain("All 1 community theme is installed");
  });
});

describe("settings: uninstall flow → theme moves back into the gallery", () => {
  it("clicking the × twice on an Installed card invokes delete_theme with that slug", async () => {
    const mocha = makeTheme({ slug: "catppuccin-mocha", source: "Installed" });
    await openWithThemes([...BUILTINS, mocha], 1);

    const card = [...topGridCards()].find((c) => c.dataset.slug === "catppuccin-mocha")!;
    const del = card.querySelector<HTMLElement>(".theme-del")!;

    del.click(); // arm — must NOT invoke delete_theme yet
    expect(invokeMock.mock.calls.find((c) => c[0] === "delete_theme")).toBeUndefined();

    del.click(); // confirm
    await Promise.resolve();
    await Promise.resolve();

    const call = invokeMock.mock.calls.find((c) => c[0] === "delete_theme");
    expect(call, "delete_theme must be invoked").not.toBeUndefined();
    expect(call![1]).toEqual({ slug: "catppuccin-mocha", activeSlug: "kimbo-dark" });
  });

  it("after the backend emits the post-uninstall event, the theme reappears in the gallery", async () => {
    const mocha = makeTheme({ slug: "catppuccin-mocha", source: "Installed" });
    await openWithThemes([...BUILTINS, mocha], 1);

    // Sanity: starts in top grid, NOT in gallery.
    expect([...topGridCards()].map((c) => c.dataset.slug)).toContain("catppuccin-mocha");
    expect([...galleryCards()].length).toBe(0);

    // Backend fires the updated event after delete_theme finishes.
    const mochaNowAvailable = makeTheme({ slug: "catppuccin-mocha", source: "Available" });
    emitThemesReady([...BUILTINS, mochaNowAvailable], 1);

    expect([...galleryCards()].map((c) => c.dataset.slug)).toContain("catppuccin-mocha");
    expect([...topGridCards()].map((c) => c.dataset.slug)).not.toContain("catppuccin-mocha");
  });

  it("the × button on an Installed card switches to a 'Delete?' pill on first click", async () => {
    const mocha = makeTheme({ slug: "catppuccin-mocha", source: "Installed" });
    await openWithThemes([...BUILTINS, mocha], 1);

    const card = [...topGridCards()].find((c) => c.dataset.slug === "catppuccin-mocha")!;
    const del = card.querySelector<HTMLElement>(".theme-del")!;

    expect(del.classList.contains("arm")).toBe(false);
    del.click();
    expect(del.classList.contains("arm")).toBe(true);
    expect(del.querySelector("span")?.textContent).toBe("Delete?");
  });
});

describe("settings: uninstalling the ACTIVE theme", () => {
  // The Rust backend refuses to delete the active theme (it would leave the
  // app pointing at a missing file). Without the workaround below, the
  // uninstall fails silently — the user clicks Delete? and nothing happens
  // (alert() is a no-op in Tauri 2 without the dialog plugin). The frontend
  // must auto-switch to kimbo-dark first so the delete actually proceeds.

  it("when the active theme is uninstalled, the frontend switches to kimbo-dark BEFORE calling delete_theme", async () => {
    // Mocha is the active theme.
    const mocha = makeTheme({ slug: "catppuccin-mocha", source: "Installed", active: true });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") {
        const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        cfg.theme.name = "catppuccin-mocha";
        return cfg;
      }
      if (cmd === "list_unified_themes") return [...BUILTINS, mocha];
      return undefined;
    });
    await openSettingsToCategory("appearance");
    emitThemesReady([...BUILTINS, mocha], 1);

    const card = [...topGridCards()].find((c) => c.dataset.slug === "catppuccin-mocha")!;
    const del = card.querySelector<HTMLElement>(".theme-del")!;
    del.click(); // arm
    del.click(); // confirm

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // First, save_config must have been called with the new active theme.
    const saveCall = invokeMock.mock.calls.find(
      (c) => c[0] === "save_config" && c[1]?.config?.theme?.name === "kimbo-dark",
    );
    expect(saveCall, "must save config with kimbo-dark before deleting").not.toBeUndefined();

    // Then delete_theme must be invoked with activeSlug pointing at the NEW
    // active (kimbo-dark) — otherwise the backend's "is the active theme"
    // guard rejects the call.
    const deleteCall = invokeMock.mock.calls.find((c) => c[0] === "delete_theme");
    expect(deleteCall, "delete_theme must be invoked").not.toBeUndefined();
    expect(deleteCall![1]).toEqual({ slug: "catppuccin-mocha", activeSlug: "kimbo-dark" });

    // And the order must be: save_config → delete_theme (not the reverse).
    const callIndices = invokeMock.mock.calls.map((c) => c[0]);
    const saveIdx = callIndices.indexOf("save_config");
    const deleteIdx = callIndices.indexOf("delete_theme");
    expect(saveIdx).toBeLessThan(deleteIdx);
  });
});

describe("settings: builtin themes are not deletable", () => {
  it("Builtin theme cards have NO uninstall × visible", async () => {
    await openWithThemes([...BUILTINS], 0);

    const cards = [...topGridCards()];
    for (const card of cards) {
      const slug = card.dataset.slug;
      expect(slug === "kimbo-dark" || slug === "kimbo-light").toBe(true);
      expect(card.querySelector(".theme-del")).toBeNull();
    }
  });
});
