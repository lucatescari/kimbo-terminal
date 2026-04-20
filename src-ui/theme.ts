import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";

interface ResolvedTheme {
  name: string;
  theme_type: string;
  background: string;
  foreground: string;
  cursor: string;
  selection_background: string;
  ansi_black: string;
  ansi_red: string;
  ansi_green: string;
  ansi_yellow: string;
  ansi_blue: string;
  ansi_magenta: string;
  ansi_cyan: string;
  ansi_white: string;
  ansi_bright_black: string;
  ansi_bright_red: string;
  ansi_bright_green: string;
  ansi_bright_yellow: string;
  ansi_bright_blue: string;
  ansi_bright_magenta: string;
  ansi_bright_cyan: string;
  ansi_bright_white: string;
  tab_active_bg: string;
  tab_inactive_bg: string;
  tab_active_fg: string;
  tab_inactive_fg: string;
  titlebar_bg: string;
  border: string;
  active_border: string;
}

const terminals: Terminal[] = [];
let currentXtermTheme: Record<string, string> | null = null;

export interface TerminalOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  scrollback: number;
}

let currentTerminalOptions: TerminalOptions = {
  fontFamily: "'JetBrains Mono', 'Menlo', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10_000,
};

export function getTerminalOptions(): TerminalOptions {
  return currentTerminalOptions;
}

/**
 * Ensures the font family xterm sees is a CSS-valid quoted name with a
 * monospace fallback. Bare config values like "JetBrains Mono" would render
 * with a random fallback font if that face isn't installed; this wraps the
 * name and appends `monospace` so xterm always has a safe chain.
 */
export function normalizeFontFamily(name: string): string {
  const s = (name ?? "").trim();
  if (!s) return "'Menlo', monospace";
  if (s.includes(",")) return s;
  const quoted = s.startsWith("'") || s.startsWith('"') ? s : `'${s}'`;
  return `${quoted}, monospace`;
}

/** Apply a new set of terminal options to all registered terminals. */
export function applyTerminalOptions(opts: Partial<TerminalOptions>) {
  currentTerminalOptions = { ...currentTerminalOptions, ...opts };
  const family = normalizeFontFamily(currentTerminalOptions.fontFamily);
  for (const term of terminals) {
    term.options.fontFamily = family;
    term.options.fontSize = currentTerminalOptions.fontSize;
    term.options.lineHeight = currentTerminalOptions.lineHeight;
    term.options.cursorStyle = currentTerminalOptions.cursorStyle;
    term.options.cursorBlink = currentTerminalOptions.cursorBlink;
    term.options.scrollback = currentTerminalOptions.scrollback;
  }
}

export function registerTerminal(term: Terminal) {
  terminals.push(term);
  // Apply current theme to newly registered terminal.
  if (currentXtermTheme) {
    term.options.theme = currentXtermTheme;
  }
}

export function unregisterTerminal(term: Terminal) {
  const idx = terminals.indexOf(term);
  if (idx >= 0) terminals.splice(idx, 1);
}

export async function loadTheme(name: string): Promise<void> {
  const theme = await invoke<ResolvedTheme>("get_theme", { name });
  applyTheme(theme);
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--fg", theme.foreground);
  root.style.setProperty("--cursor", theme.cursor);
  root.style.setProperty("--titlebar-bg", theme.titlebar_bg);
  root.style.setProperty("--tab-bar-bg", theme.titlebar_bg);
  root.style.setProperty("--tab-active-bg", theme.tab_active_bg);
  root.style.setProperty("--tab-inactive-bg", theme.tab_inactive_bg);
  root.style.setProperty("--tab-active-fg", theme.tab_active_fg);
  root.style.setProperty("--tab-inactive-fg", theme.tab_inactive_fg);
  root.style.setProperty("--border", theme.border);
  root.style.setProperty("--active-border", theme.active_border);
  // `--surface` is our "card / input / raised panel" background. Themes don't
  // declare a separate field for it, so we reuse `tab_active_bg` (the same
  // elevated tone used for the active tab).
  root.style.setProperty("--surface", theme.tab_active_bg);
  // Accent tokens surfaced from the ANSI palette for UI chrome (error text,
  // badges, overlays). Using theme colors keeps them readable on any theme.
  root.style.setProperty("--accent-red", theme.ansi_red);
  root.style.setProperty("--accent-yellow", theme.ansi_yellow);
  root.style.setProperty("--accent-blue", theme.ansi_blue);
  root.style.setProperty("--accent-green", theme.ansi_green);

  // Theme-type drives the new design tokens that differ between light/dark
  // (shadow weights, fg-strong lift). theme_type comes from the resolved
  // theme file ("light" | "dark" | "high-contrast" | …).
  root.dataset.themeType = theme.theme_type || "dark";

  const xtermTheme: Record<string, string> = {
    // Transparent so #app-frame (which carries --app-alpha chrome fill) shows
    // through under the terminal viewport. The theme's background hex is still
    // used for the CSS --bg token upstream of this function.
    background: "rgba(0,0,0,0)",
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selection_background,
    black: theme.ansi_black,
    red: theme.ansi_red,
    green: theme.ansi_green,
    yellow: theme.ansi_yellow,
    blue: theme.ansi_blue,
    magenta: theme.ansi_magenta,
    cyan: theme.ansi_cyan,
    white: theme.ansi_white,
    brightBlack: theme.ansi_bright_black,
    brightRed: theme.ansi_bright_red,
    brightGreen: theme.ansi_bright_green,
    brightYellow: theme.ansi_bright_yellow,
    brightBlue: theme.ansi_bright_blue,
    brightMagenta: theme.ansi_bright_magenta,
    brightCyan: theme.ansi_bright_cyan,
    brightWhite: theme.ansi_bright_white,
  };

  currentXtermTheme = xtermTheme;

  for (const term of terminals) {
    term.options.theme = xtermTheme;
  }
}
