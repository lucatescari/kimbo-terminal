// UI-only preferences persisted to localStorage.
//
// Backed by config.toml are things the Rust side needs (fonts, theme, kimbo,
// updates). Pure presentation toggles (density, tab style, accent override,
// "coming soon" placeholders) live here so we don't have to migrate the Rust
// schema just to flip a class name.

const KEY = "kimbo-ui-prefs-v1";

export type Density = "compact" | "comfortable" | "roomy";
export type TabStyle = "underline" | "pill" | "chevron";
export type WindowChrome = "native" | "flat" | "hidden";
export type NewWindowPosition = "cursor" | "center" | "last";
export type FontSmoothing = "none" | "grayscale" | "subpixel";
export type ReleaseChannel = "stable" | "beta" | "nightly";

export interface UiPrefs {
  density: Density;
  tabStyle: TabStyle;
  /** Accent color hex (e.g. "#8aa9ff"), or "" to defer to the theme accent. */
  accent: string;
  /** General → Window chrome. Coming soon. */
  windowChrome: WindowChrome;
  /** General → Confirm quit with active panes. */
  confirmQuit: boolean;
  /** General → New window position. Coming soon. */
  newWindowPosition: NewWindowPosition;
  /** General → Background opacity (0–100). Settings slider is enabled on
   *  macOS only; value is always written to --app-alpha by applyRoot(). */
  backgroundOpacity: number;
  /** Advanced → GPU rendering. Coming soon (xterm already uses WebGL). */
  gpuRendering: boolean;
  /** Advanced → Flush interval ms. Coming soon. */
  flushIntervalMs: number;
  /** Advanced → Anonymous telemetry. Coming soon (no backend). */
  telemetry: boolean;
  /** About → Release channel. Coming soon. */
  releaseChannel: ReleaseChannel;
  /** Font → Smoothing. Coming soon. */
  fontSmoothing: FontSmoothing;
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
}

const DEFAULTS: UiPrefs = {
  density: "comfortable",
  tabStyle: "underline",
  accent: "",
  windowChrome: "native",
  confirmQuit: true,
  newWindowPosition: "last",
  backgroundOpacity: 100,
  gpuRendering: true,
  flushIntervalMs: 16,
  telemetry: false,
  releaseChannel: "stable",
  fontSmoothing: "subpixel",
  startup: "last",
  transparentBlackBg: true,
  claudeHudEnabled: true,
  claudeHudExtended: false,
  claudeHudShowPlan: false,
};

let cache: UiPrefs | null = null;

export function getPrefs(): UiPrefs {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      cache = { ...DEFAULTS, ...JSON.parse(raw) };
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

/** Apply density/accent/tab-style to the document root / tab bar. Safe to
 *  call any time (e.g. after theme change). */
export function applyRoot(): void {
  const prefs = getPrefs();
  const root = document.documentElement;
  root.dataset.density = prefs.density;

  // Accent override: set inline --accent var so it wins over the stylesheet.
  if (prefs.accent) {
    root.style.setProperty("--accent", prefs.accent);
    root.style.setProperty("--accent-tint", hexToTint(prefs.accent, 0.14));
    root.style.setProperty("--accent-strong", prefs.accent);
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-tint");
    root.style.removeProperty("--accent-strong");
  }

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

function hexToTint(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return `rgba(120,150,255,${alpha})`;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** For tests: reset in-memory cache so the next getPrefs() re-reads storage. */
export function resetCache(): void {
  cache = null;
}
