import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { initTabs, createTab, fitAllPanes, closeTab, getActiveTab, splitActive, closeActiveOrTab, switchToTab, snapshotOpenTabs } from "./tabs";
import { initKeys } from "./keys";
import { applyTerminalOptions, loadTheme, NERD_FONT_FAMILY } from "./theme";
import { initSettings, toggleSettings } from "./settings";
import { listen } from "@tauri-apps/api/event";
import { initKimbo, setKimboSettingsHandler } from "./kimbo";
import { initDragDrop } from "./drag-drop";
import { initUpdateCheck } from "./updates";
import { initWelcome } from "./welcome-popup";
import { setTabTitleHandler } from "./terminal";
import { setTabTitle } from "./tabs";
import { initFindBar } from "./find-bar";
import { initTitleBar } from "./title-bar";
import { initStatusBar } from "./status-bar";
import { initCommandPalette } from "./command-palette";
import { applyRoot, onChange as onPrefsChange, getPrefs } from "./ui-prefs";
import { loadSession, startSessionAutosave } from "./session-state";

interface BootConfig {
  font: { family: string; size: number; line_height: number };
  theme: { name: string };
  scrollback: { lines: number };
  cursor: { style: string; blink: boolean };
  kimbo: { enabled: boolean; corner: string; shell_integration: boolean };
  updates: { auto_check: boolean };
  welcome: { show_on_startup: boolean };
}

async function init() {
  const titleBar = document.getElementById("title-bar")!;
  const tabBar = document.getElementById("tab-bar")!;
  const terminalArea = document.getElementById("terminal-area")!;
  const statusBar = document.getElementById("status-bar")!;
  // #overlay used to host the standalone ⌘O launcher; the palette hosts its
  // own modal now, so the element is no longer read here. Left in index.html
  // as a harmless no-op anchor in case a future feature wants a root-level
  // overlay slot.

  // UI prefs apply once (density, accent, tab-style) before the chrome mounts,
  // so the first paint already has the right data-attributes.
  applyRoot();

  initTabs(tabBar, terminalArea);
  initTitleBar(titleBar);
  initStatusBar(statusBar);
  initSettings(terminalArea);
  initCommandPalette();
  initFindBar(document.body);
  setTabTitleHandler((sessionId, title) => setTabTitle(sessionId, title));

  // Re-apply root on pref change so accent/density/tab-style changes land live.
  onPrefsChange(() => applyRoot());

  // Seed terminal options from persisted config before creating any terminal.
  let themeName = "kimbo-dark";
  let cfg: BootConfig | null = null;
  try {
    cfg = await invoke<BootConfig>("get_config");
    themeName = cfg.theme.name || themeName;
    applyTerminalOptions({
      fontFamily: cfg.font.family,
      fontSize: cfg.font.size,
      lineHeight: cfg.font.line_height,
      cursorStyle: cfg.cursor.style as "block" | "underline" | "bar",
      cursorBlink: cfg.cursor.blink,
      scrollback: cfg.scrollback.lines,
    });
  } catch (e) {
    console.warn("Failed to load config, using defaults:", e);
  }

  // Theme loading is non-critical — don't block terminal creation.
  try {
    await loadTheme(themeName);
  } catch (e) {
    console.warn("Failed to load theme, using defaults:", e);
  }
  applyRoot();

  // Init Kimbo from persisted config.
  try {
    const k = cfg?.kimbo ?? { enabled: true, corner: "bottom_right", shell_integration: false };
    initKimbo(document.body, { enabled: !!k.enabled, corner: (k.corner ?? "bottom_right") as any, shellIntegration: !!k.shell_integration });
    setKimboSettingsHandler(() => toggleSettings());
  } catch (e) {
    console.warn("Failed to init Kimbo:", e);
  }

  // Background update check (silent — never blocks startup, never throws).
  if (cfg) {
    initUpdateCheck(cfg).catch((e) => console.warn("initUpdateCheck:", e));
  }

  if (cfg) initWelcome(cfg);

  initKeys();

  // Force-load the Nerd Font fallback before the first terminal renders so
  // xterm's WebGL glyph atlas rasterizes shell-prompt icons (starship,
  // spaceship, p10k) against the bundled font on first paint. Without this,
  // the atlas can cache a squished system-font fallback that only corrects
  // itself after a reflow. Pass a PUA codepoint as the test string so the
  // browser actually triggers the font fetch — an empty test string won't
  // match glyphs if the @font-face is ever unicode-range-restricted.
  await preloadNerdFont();

  // Startup tab plan. "last" tries to restore the saved session; "home" and
  // "workspace" fall through to the default `createTab()` path today (the
  // workspace-aware branch will grow when workspaces land per-tab state).
  await openInitialTabs();

  // Kick off session autosave AFTER the initial tabs are in place so the
  // first snapshot the poller sees is a real session and we don't blow the
  // saved state away with a "zero tabs" write during the split-second
  // before openInitialTabs awaits its first createTab.
  startSessionAutosave(() => snapshotOpenTabs());

  // Enable file drag-drop → paste paths into target pane.
  try {
    await initDragDrop();
  } catch (e) {
    console.warn("Failed to init drag-drop:", e);
  }

  // Listen for macOS menu bar actions.
  await listen<string>("menu-action", (event) => {
    switch (event.payload) {
      case "settings": toggleSettings(); break;
      case "new_tab": createTab(); break;
      case "close_pane": closeActiveOrTab(); break;
      case "close_tab": { const t = getActiveTab(); if (t) closeTab(t.id); } break;
      case "split_vertical": splitActive("vertical"); break;
      case "split_horizontal": splitActive("horizontal"); break;
    }
  });

  // Handle window resize.
  const resizeObserver = new ResizeObserver(() => {
    fitAllPanes();
  });
  resizeObserver.observe(terminalArea);
}

init().catch(console.error);

/** Open the initial tab(s) based on `prefs.startup`. On "last" we replay
 *  the saved session (one fresh tab per persisted tab, at that tab's cwd)
 *  and then focus the last-active one. Any failure — corrupt state, a cwd
 *  that no longer exists, createTab throwing — falls through to the
 *  default single tab so the app still launches in a usable state. */
async function openInitialTabs(): Promise<void> {
  const mode = getPrefs().startup;
  if (mode === "last") {
    const saved = loadSession();
    if (saved && saved.tabs.length > 0) {
      try {
        for (const t of saved.tabs) {
          await createTab(t.cwd ?? undefined);
        }
        if (saved.activeIndex > 0 && saved.activeIndex < saved.tabs.length) {
          switchToTab(saved.activeIndex);
        }
        return;
      } catch (e) {
        console.warn("[kimbo.session] restore failed, falling back:", e);
        // Fall through to default.
      }
    }
  }
  // "home" / "workspace" / fallback: one tab at the default cwd. The
  // backend picks $HOME when cwd is undefined, which is what the user
  // expects for both "home" and "workspace" today.
  await createTab();
}

/** Preload the bundled Nerd Font AND verify it renders nerd glyphs at the
 *  same advance width as the primary mono font. Logs a clear, greppable
 *  status line so a stale-asset or broken-CSS-path problem shows up in the
 *  devtools console instead of silently degrading to a squished fallback. */
async function preloadNerdFont(): Promise<void> {
  // Pass a PUA codepoint as the test string so the browser actually triggers
  // the font fetch — an empty test string wouldn't match glyphs if the
  // @font-face is ever unicode-range-restricted. We load at both sizes
  // Kimbo uses (default 14, themes may bump to 16). fonts.ready waits for
  // the document's whole font-loading state, which is stricter than the
  // individual FontFace.load() promises in some browsers.
  try {
    await Promise.all([
      document.fonts.load(`14px '${NERD_FONT_FAMILY}'`, "\uf023"),
      document.fonts.load(`16px '${NERD_FONT_FAMILY}'`, "\uf023"),
    ]);
    await document.fonts.ready;
    if (!document.fonts.check(`14px '${NERD_FONT_FAMILY}'`, "\uf023")) {
      console.warn(
        `[kimbo.font] '${NERD_FONT_FAMILY}' did not resolve for PUA glyphs; ` +
          `shell-prompt icons will fall back to a system font and may render ` +
          `with wrong cell metrics. Check /fonts/JetBrainsMonoNerdFontMono-` +
          `Regular.ttf is reachable.`,
      );
    }
  } catch (e) {
    console.warn("[kimbo.font] preload threw:", e);
  }
}
