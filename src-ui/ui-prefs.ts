// UI-only preferences persisted to localStorage.
//
// Backed by config.toml are things the Rust side needs (fonts, theme, kimbo,
// updates). Pure presentation toggles (density, tab style, "coming soon"
// placeholders) live here so we don't have to migrate the Rust schema just to
// flip a class name.

import type { ThemeMode } from "./theme-filter";

const KEY = "kimbo-ui-prefs-v1";

export type ClaudeSplitTarget = "vertical" | "horizontal" | "tab";

export type Density = "compact" | "comfortable" | "roomy";
export type TabStyle = "underline" | "pill" | "chevron";

export interface UiPrefs {
  density: Density;
  tabStyle: TabStyle;
  /** General → Confirm quit with active panes. */
  confirmQuit: boolean;
  /** General → Background opacity (0–100). Settings slider is enabled on
   *  macOS only; value is always written to --app-alpha by applyRoot(). */
  backgroundOpacity: number;
  /** General → Open on launch. "last" — restore, "home" — home dir, "workspace" — last workspace. */
  startup: "last" | "home" | "workspace";
  /** Appearance → Treat ANSI black bg as default (transparent).
   *  When on, CLI tools that emit green-on-black labels (vite/tauri/chalk)
   *  render with the window's translucent bg instead of an opaque rectangle. */
  transparentBlackBg: boolean;
  /** Claude Code → Show the per-pane HUD (session id, model, tokens,
   *  cost, duration) below the pane head when claude is running. */
  claudeHudEnabled: boolean;
  /** Claude Code → Append permission mode + message/tool counts to the
   *  HUD line. Defaults to off; the base HUD already covers the common
   *  case. */
  claudeHudExtended: boolean;
  /** Claude Code → Append the subscription tier (e.g. "max") in
   *  parentheses after the email. Defaults to off. */
  claudeHudShowPlan: boolean;
  /** Split the pane and open the other side when a Claude session branches
   *  (/branch) or forks (/fork). On by default; the split is the point of the
   *  feature, but it is an action the user did not directly ask for, so it
   *  must be switchable off. */
  claudeAutoSplitBranches: boolean;
  /** Where the other side of a branch or fork opens. */
  claudeSplitTarget: ClaudeSplitTarget;
  /** Claude Code → Show 5h / weekly rate-limit percentages in the HUD
   *  instead of token counts / cost. Installs a tiny shim into the Claude
   *  Code config. Tri-state:
   *   - undefined  → never decided; triggers smart auto-install (Task 16).
   *   - true       → user explicitly enabled.
   *   - false      → user explicitly disabled.
   *   - "dismissed" → auto-install was blocked (existing statusLine), user
   *                   chose not to replace it. */
  claudeRateLimitsEnabled?: boolean | "dismissed";
  /** Claude Code → Notifications. Tri-state like claudeRateLimitsEnabled:
   *   - undefined  → never decided; triggers smart auto-install (Task 24).
   *   - true       → user explicitly enabled.
   *   - false      → user explicitly disabled.
   *   - "dismissed" → auto-install was offered but the user dismissed. */
  notifyOnStop?: boolean | "dismissed";
  notifyOnPermission?: boolean | "dismissed";
  /** Claude Code → Notifications → play sound on the macOS notification.
   *  Silent by default. */
  notifySoundEnabled: boolean;
  /** Flash the pane on terminal bell (BEL 0x07). */
  bellVisual: boolean;
  /** Play a short beep on terminal bell. Off by default. */
  bellSound: boolean;
  /** Appearance → Themes grid. Hard filter applied to both the
   *  built-in/installed grid and the community gallery. Persisted so a
   *  user who only wants dark themes doesn't re-pick on each open. */
  themePickerMode: ThemeMode;
}

const DEFAULTS: UiPrefs = {
  density: "comfortable",
  tabStyle: "underline",
  confirmQuit: true,
  backgroundOpacity: 100,
  startup: "last",
  transparentBlackBg: true,
  claudeHudEnabled: true,
  claudeHudExtended: false,
  claudeHudShowPlan: false,
  claudeAutoSplitBranches: true,
  claudeSplitTarget: "vertical",
  notifySoundEnabled: false,
  bellVisual: true,
  bellSound: false,
  themePickerMode: "all",
};

let cache: UiPrefs | null = null;

export function getPrefs(): UiPrefs {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // Keep only fields that still exist. Spreading the stored object wholesale
      // let a retired preference survive forever — the accent override outlived
      // its own removal this way, and setPref would write it straight back to
      // disk. Filtering here retires any removed field on next load.
      const stored = JSON.parse(raw) as Record<string, unknown>;
      const known = Object.fromEntries(
        Object.entries(stored).filter(([k]) => k in DEFAULTS),
      );
      cache = { ...DEFAULTS, ...known } as UiPrefs;
      return cache!;
    }
  } catch (_) { /* ignore */ }
  cache = { ...DEFAULTS };
  return cache;
}

export function setPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  const prefs = { ...getPrefs(), [key]: value } as UiPrefs;
  cache = prefs;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (_) { /* ignore */ }
  applyRoot();
  notify();
}

/** Apply density/tab-style to the document root / tab bar. Safe to
 *  call any time (e.g. after theme change). */
export function applyRoot(): void {
  const prefs = getPrefs();
  const root = document.documentElement;
  root.dataset.density = prefs.density;

  // Tab-style attribute on tab bar.
  const bar = document.getElementById("tab-bar");
  if (bar) bar.dataset.style = prefs.tabStyle;

  // Window translucency alpha. At 100 → "1" (fully opaque; the vibrancy
  // layer mounted on the Rust side is hidden). Below 100 scales the
  // chrome fill so the blur shows through. Single source of truth for
  // all chrome surfaces; see style.css #app-frame, #title-bar, tab fills.
  root.style.setProperty("--app-alpha", String(prefs.backgroundOpacity / 100));
}

type Listener = (p: UiPrefs) => void;
const listeners = new Set<Listener>();
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  const p = getPrefs();
  for (const l of listeners) l(p);
}


/** For tests: reset in-memory cache so the next getPrefs() re-reads storage. */
export function resetCache(): void {
  cache = null;
}

/** Wipe all UI preferences from localStorage and drop the in-memory cache.
 *  Used by Settings → Advanced → "Reset all settings"; the caller reloads the
 *  window afterward so defaults re-apply. */
export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (_) { /* ignore */ }
  cache = null;
}
