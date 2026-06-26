import {
  nextTab,
  prevTab,
  switchToTab,
  focusDirection,
} from "./tabs";
import { jumpToPrevPrompt, jumpToNextPrompt } from "./prompt-jump";
import { isSettingsVisible, hideSettings } from "./settings";
import { toggleFindBar, isFindBarVisible, hideFindBar } from "./find-bar";
import { toggleCommandPalette, toggleProjectsPalette, isCommandPaletteVisible, hideCommandPalette } from "./command-palette";
import { chordFromEvent, actionForChord, loadOverrides } from "./keybindings";

// Webview-owned shortcuts ONLY. The native-menu shortcuts (new_tab, close_pane,
// close_tab, reopen_tab, split_vertical, split_horizontal, settings, quit) are
// handled by the macOS menu and routed through main.ts's menu-action switch —
// they are deliberately absent here so the webview never double-fires them.
// (macOS reserves key-equivalents like ⌘W/⌘Q; they must be menu-owned.)
const HANDLERS: Record<string, () => void> = {
  next_tab:        () => nextTab(),
  prev_tab:        () => prevTab(),
  focus_up:        () => focusDirection("horizontal", false),
  focus_down:      () => focusDirection("horizontal", true),
  focus_left:      () => focusDirection("vertical", false),
  focus_right:     () => focusDirection("vertical", true),
  command_palette:  () => toggleCommandPalette(),
  projects:         () => toggleProjectsPalette(),
  find:             () => toggleFindBar(),
  jump_prev_prompt: () => jumpToPrevPrompt(),
  jump_next_prompt: () => jumpToNextPrompt(),
};

/** @param overrides persisted user keybinding overrides (config.keybindings.bindings) */
export function initKeys(overrides: Record<string, string> = {}) {
  loadOverrides(overrides);

  document.addEventListener("keydown", (e) => {
    // Escape: close launcher or settings if visible, otherwise let xterm.js handle it.
    if (e.key === "Escape") {
      if (isFindBarVisible()) { e.preventDefault(); hideFindBar(); return; }
      if (isCommandPaletteVisible()) { e.preventDefault(); hideCommandPalette(); return; }
      if (isSettingsVisible()) { e.preventDefault(); hideSettings(); return; }
    }

    // Fixed positional tab switching ⌘1–9 (not user-rebindable).
    if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      switchToTab(parseInt(e.key, 10) - 1);
      return;
    }

    const chord = chordFromEvent(e);
    if (!chord) return;
    const id = actionForChord(chord);
    if (!id) return;
    // Menu-owned actions resolve here too (for conflict bookkeeping) but have
    // no webview handler — the native menu fires them. Only non-menu actions
    // are dispatched from the webview.
    const handler = HANDLERS[id];
    if (!handler) return;
    e.preventDefault();
    e.stopPropagation();
    handler();
  });
}
