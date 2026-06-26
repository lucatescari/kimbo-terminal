// Single source of truth for Kimbo's rebindable keyboard shortcuts.
//
// Pure data + chord utilities + override state — no xterm/Tauri deps, so the
// matching rules are unit-testable in isolation. keys.ts wires each action id
// to a handler and uses this module to match events; settings.ts renders and
// edits the bindings. Defaults live here; config.keybindings.bindings persists
// ONLY user overrides.
//
// Chord format is canonical lowercase-dash, matching the config schema:
//   "cmd-t", "cmd-shift-d", "cmd-]", "cmd-up"
// Modifier order is always cmd, ctrl, alt, shift, then the key.

export interface ActionDef {
  id: string;
  label: string;
  category: "app" | "tabs" | "panes" | "nav" | "edit";
  defaultChord: string;
  /** True if this action is backed by a native macOS menu item (main.rs).
   *  macOS reserves key-equivalents like ⌘W/⌘Q, so these MUST be owned by the
   *  menu (its accelerator), not the webview keydown path — otherwise the OS
   *  hijacks the key. Rebinding a menu action updates the menu accelerator via
   *  Rust; the webview handler ignores it (avoiding double-dispatch). */
  menu?: boolean;
}

/** Every rebindable action. Positional ⌘1–9 tab switching is intentionally
 *  excluded (kept fixed). Order here is the display order in settings. */
export const ACTIONS: ActionDef[] = [
  { id: "new_tab",          label: "New tab",            category: "tabs",  defaultChord: "cmd-t",       menu: true },
  { id: "reopen_tab",       label: "Reopen closed tab",  category: "tabs",  defaultChord: "cmd-shift-t", menu: true },
  { id: "close_tab",        label: "Close tab",          category: "tabs",  defaultChord: "cmd-shift-w", menu: true },
  { id: "next_tab",         label: "Next tab",           category: "tabs",  defaultChord: "cmd-]" },
  { id: "prev_tab",         label: "Previous tab",       category: "tabs",  defaultChord: "cmd-[" },
  { id: "split_vertical",   label: "Split right",        category: "panes", defaultChord: "cmd-d",       menu: true },
  { id: "split_horizontal", label: "Split down",         category: "panes", defaultChord: "cmd-shift-d", menu: true },
  { id: "close_pane",       label: "Close pane",         category: "panes", defaultChord: "cmd-w",       menu: true },
  { id: "focus_up",         label: "Focus pane up",      category: "panes", defaultChord: "cmd-up" },
  { id: "focus_down",       label: "Focus pane down",    category: "panes", defaultChord: "cmd-down" },
  { id: "focus_left",       label: "Focus pane left",    category: "panes", defaultChord: "cmd-left" },
  { id: "focus_right",      label: "Focus pane right",   category: "panes", defaultChord: "cmd-right" },
  { id: "command_palette",  label: "Command palette",    category: "nav",   defaultChord: "cmd-k" },
  { id: "projects",         label: "Projects",           category: "nav",   defaultChord: "cmd-o" },
  { id: "settings",         label: "Settings",           category: "nav",   defaultChord: "cmd-,",       menu: true },
  { id: "find",             label: "Find in terminal",   category: "edit",  defaultChord: "cmd-f" },
  { id: "jump_prev_prompt", label: "Jump to previous prompt", category: "nav", defaultChord: "cmd-shift-up" },
  { id: "jump_next_prompt", label: "Jump to next prompt",     category: "nav", defaultChord: "cmd-shift-down" },
  { id: "quit",             label: "Quit",               category: "app",   defaultChord: "cmd-q",       menu: true },
];

/** Whether the action id is backed by a native menu item. */
export function isMenuAction(id: string): boolean {
  return ACTIONS.find((a) => a.id === id)?.menu === true;
}

const MODIFIERS = new Set(["cmd", "ctrl", "alt", "shift"]);
const MODIFIER_KEYS = new Set(["Meta", "Shift", "Control", "Alt", "CapsLock", "Fn"]);

/** Normalize a KeyboardEvent.key to a chord token, or null if it's a bare
 *  modifier press (which can't be a chord on its own). */
function normalizeKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key)) return null;
  switch (key) {
    case "ArrowUp": return "up";
    case "ArrowDown": return "down";
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
  }
  if (/^[a-zA-Z]$/.test(key)) return key.toLowerCase();
  return key; // punctuation etc. kept verbatim ("]", "[", ",")
}

/** Build a canonical chord string from a keyboard event. Returns null unless
 *  Cmd is held (we require ⌘) and a real key is pressed. */
export function chordFromEvent(e: KeyboardEvent): string | null {
  if (!e.metaKey) return null;
  const key = normalizeKey(e.key);
  if (!key) return null;
  const parts = ["cmd"];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("-");
}

const DISPLAY: Record<string, string> = {
  cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧",
  up: "↑", down: "↓", left: "←", right: "→",
};

/** Convert a chord to display symbols, e.g. "cmd-shift-d" → ["⌘","⇧","D"]. */
export function chordToDisplayParts(chord: string): string[] {
  return chord.split("-").map((p) => DISPLAY[p] ?? (p.length === 1 ? p.toUpperCase() : p));
}

/** A chord is valid for binding only if it includes Cmd and ends in a real
 *  (non-modifier) key. */
export function isValidChord(chord: string): boolean {
  const parts = chord.split("-");
  if (!parts.includes("cmd")) return false;
  const last = parts[parts.length - 1];
  return !MODIFIERS.has(last) && parts.length >= 2;
}

const KNOWN_IDS = new Set(ACTIONS.map((a) => a.id));
let overrideMap: Record<string, string> = {};

/** Replace the override set from persisted config; unknown ids are dropped. */
export function loadOverrides(record: Record<string, string>): void {
  overrideMap = {};
  for (const [id, chord] of Object.entries(record ?? {})) {
    if (KNOWN_IDS.has(id)) overrideMap[id] = chord;
  }
}

export function setOverride(id: string, chord: string): void {
  if (KNOWN_IDS.has(id)) overrideMap[id] = chord;
}

export function resetOverrides(): void {
  overrideMap = {};
}

/** Current overrides only (defaults excluded) — what gets persisted. */
export function overrides(): Record<string, string> {
  return { ...overrideMap };
}

const DEFAULT_BY_ID = new Map(ACTIONS.map((a) => [a.id, a.defaultChord]));

/** The chord currently bound to an action: its override, else its default. */
export function activeChord(id: string): string {
  return overrideMap[id] ?? DEFAULT_BY_ID.get(id) ?? "";
}

/** Reverse lookup: which action (if any) the chord is currently bound to.
 *  Honors overrides. Used for runtime matching and conflict detection. */
export function actionForChord(chord: string): string | undefined {
  for (const a of ACTIONS) {
    if (activeChord(a.id) === chord) return a.id;
  }
  return undefined;
}
