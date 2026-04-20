import {
  createTab,
  closeTab,
  nextTab,
  prevTab,
  switchToTab,
  getActiveTab,
  splitActive,
  closeActiveOrTab,
  focusDirection,
} from "./tabs";
import { toggleLauncher, isLauncherVisible, hideLauncher } from "./launcher";
import { toggleSettings, isSettingsVisible, hideSettings } from "./settings";
import { toggleFindBar, isFindBarVisible, hideFindBar } from "./find-bar";
import { toggleCommandPalette, isCommandPaletteVisible, hideCommandPalette } from "./command-palette";
import { invoke } from "@tauri-apps/api/core";

interface Shortcut {
  key: string;
  meta?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  action: () => void;
}

const shortcuts: Shortcut[] = [
  // App lifecycle
  { key: "q", meta: true, action: () => invoke("quit_app") },

  // Tabs
  { key: "t", meta: true, action: () => createTab() },
  { key: "w", meta: true, shift: true, action: () => { const t = getActiveTab(); if (t) closeTab(t.id); } },
  { key: "]", meta: true, action: () => nextTab() },
  { key: "[", meta: true, action: () => prevTab() },
  { key: "1", meta: true, action: () => switchToTab(0) },
  { key: "2", meta: true, action: () => switchToTab(1) },
  { key: "3", meta: true, action: () => switchToTab(2) },
  { key: "4", meta: true, action: () => switchToTab(3) },
  { key: "5", meta: true, action: () => switchToTab(4) },
  { key: "6", meta: true, action: () => switchToTab(5) },
  { key: "7", meta: true, action: () => switchToTab(6) },
  { key: "8", meta: true, action: () => switchToTab(7) },
  { key: "9", meta: true, action: () => switchToTab(8) },

  // Pane splitting
  { key: "d", meta: true, action: () => splitActive("vertical") },
  { key: "d", meta: true, shift: true, action: () => splitActive("horizontal") },
  { key: "w", meta: true, action: () => closeActiveOrTab() },

  // Pane focus navigation
  { key: "ArrowUp", meta: true, action: () => focusDirection("horizontal", false) },
  { key: "ArrowDown", meta: true, action: () => focusDirection("horizontal", true) },
  { key: "ArrowLeft", meta: true, action: () => focusDirection("vertical", false) },
  { key: "ArrowRight", meta: true, action: () => focusDirection("vertical", true) },

  // Launcher
  { key: "o", meta: true, action: () => toggleLauncher() },

  // Settings
  { key: ",", meta: true, action: () => toggleSettings() },

  // Find
  { key: "f", meta: true, action: () => toggleFindBar() },

  // Command palette
  { key: "k", meta: true, action: () => toggleCommandPalette() },
];

function matchShortcut(e: KeyboardEvent): Shortcut | undefined {
  return shortcuts.find((s) => {
    if (s.key !== e.key) return false;
    if (s.meta && !e.metaKey) return false;
    if (!s.meta && e.metaKey) return false;
    if (s.shift && !e.shiftKey) return false;
    if (!s.shift && e.shiftKey) return false;
    if (s.ctrl && !e.ctrlKey) return false;
    if (!s.ctrl && e.ctrlKey) return false;
    return true;
  });
}

export function initKeys() {
  document.addEventListener("keydown", (e) => {
    // Escape: close launcher or settings if visible, otherwise let xterm.js handle it.
    if (e.key === "Escape") {
      if (isFindBarVisible()) { e.preventDefault(); hideFindBar(); return; }
      if (isCommandPaletteVisible()) { e.preventDefault(); hideCommandPalette(); return; }
      if (isLauncherVisible()) { e.preventDefault(); hideLauncher(); return; }
      if (isSettingsVisible()) { e.preventDefault(); hideSettings(); return; }
    }

    const shortcut = matchShortcut(e);
    if (shortcut) {
      e.preventDefault();
      e.stopPropagation();
      shortcut.action();
    }
  });
}
