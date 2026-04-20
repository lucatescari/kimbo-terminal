import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { initTabs, createTab, fitAllPanes, closeTab, getActiveTab, splitActive, closeActiveOrTab } from "./tabs";
import { initKeys } from "./keys";
import { applyTerminalOptions, loadTheme } from "./theme";
import { initLauncher } from "./launcher";
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
import { applyRoot, onChange as onPrefsChange } from "./ui-prefs";

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
  const overlay = document.getElementById("overlay")!;

  // UI prefs apply once (density, accent, tab-style) before the chrome mounts,
  // so the first paint already has the right data-attributes.
  applyRoot();

  initTabs(tabBar, terminalArea);
  initTitleBar(titleBar);
  initStatusBar(statusBar);
  initLauncher(overlay);
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
  await createTab();

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
