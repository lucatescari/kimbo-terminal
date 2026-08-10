// Settings — modal overlay (Kimbo Redesign handoff).
//
// Renders centered over the terminal, 200px sidebar + main content. 8 panels:
// General, Appearance, Font, Workspaces, Keybinds, Kimbo, Advanced, About.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { applyTerminalOptions, loadTheme } from "./theme";
import { fitAllPanes } from "./tabs";
import { kimboBus } from "./kimbo-bus";
import { setKimboInConsoleView, setKimboEnabled, setKimboCorner, setKimboShellIntegration } from "./kimbo";
import type { UnifiedTheme } from "./settings-types";
import { showWelcome } from "./welcome-popup";
import { icon, type IconName } from "./icons";
import { buildDropdown } from "./dropdown";
import { buildThemeCard } from "./theme-card";
import { getPrefs, setPref, applyRoot, clearPrefs, type Density, type TabStyle } from "./ui-prefs";
import {
  ACTIONS,
  type ActionDef,
  activeChord,
  chordFromEvent,
  chordToDisplayParts,
  actionForChord,
  setOverride,
  overrides,
  resetOverrides,
  isMenuAction,
} from "./keybindings";
import { isMacOS } from "./platform";
import { filterThemes, type ThemeMode } from "./theme-filter";
import {
  getCachedUpdate,
  forceCheckUpdate,
  hasPendingUpdate,
  installUpdate,
  reinstallStable,
  type UpdateStatus,
  type DownloadProgress,
} from "./updates";

// ---------------------------------------------------------------------------
// Types (mirrors Rust AppConfig)
// ---------------------------------------------------------------------------

interface AppConfig {
  general: { default_shell: string; default_layout: string };
  font: { family: string; size: number; line_height: number; ligatures: boolean };
  theme: { name: string };
  scrollback: { lines: number };
  cursor: { style: string; blink: boolean };
  keybindings: { bindings: Record<string, string> };
  workspace: { auto_detect: boolean; scan_dirs: string[] };
  kimbo: { enabled: boolean; corner: string; shell_integration: boolean };
  updates: { auto_check: boolean; channel: string };
  welcome: { show_on_startup: boolean };
  telemetry: { enabled: boolean };
  toast: { position: string };
}

export type SettingsCategory =
  | "general"
  | "appearance"
  | "font"
  | "workspaces"
  | "keybinds"
  | "kimbo"
  | "claude-code"
  | "advanced"
  | "about";

const NAV: { id: SettingsCategory; label: string; icon: IconName }[] = [
  { id: "general",    label: "General",    icon: "sliders" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "font",       label: "Font",       icon: "type" },
  { id: "workspaces", label: "Workspaces", icon: "layers" },
  { id: "keybinds",   label: "Keybinds",   icon: "keyboard" },
  { id: "kimbo",      label: "Kimbo",      icon: "smile" },
  { id: "claude-code", label: "Claude Code", icon: "smile" },
  { id: "advanced",   label: "Advanced",   icon: "wrench" },
  { id: "about",      label: "About",      icon: "info" },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let visible = false;
let config: AppConfig | null = null;
let unifiedThemes: UnifiedTheme[] = [];
let communityResolved = false;
/** Total entries in the community manifest, regardless of install state. */
let communityCatalogSize = 0;
let activeCategory: SettingsCategory = "appearance";
// Held outside renderAppearance so the search query survives re-renders of
// the panel (e.g. after activating a theme). Cleared when the settings
// modal closes — see `hideSettings()`.
let themeSearchQuery = "";
let overlayEl: HTMLElement | null = null;
// Persistent refs so a nav-bar click can refresh just the main content
// without recreating .settings — recreation replays the rise-in CSS
// animation and the user perceives it as the modal flashing closed and
// reopening on every section change.
let panelEl: HTMLElement | null = null;
let sideEl: HTMLElement | null = null;
let mainEl: HTMLElement | null = null;
let themesEventUnlisten: UnlistenFn | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
// Re-entrancy guard for toggleSettings. Without this, two rapid invocations
// (macOS native menu accelerator + the webview keydown handler, or any
// duplicate listener registration) interleave: call 1 enters showSettings,
// flips visible=true, awaits invoke("get_config"); call 2 sees visible=true
// and runs hideSettings (no-op since the overlay isn't mounted yet); call 1
// then mounts the overlay with visible=false, leaving the modal visible but
// flagged as hidden. Same shape as the closeInFlight guard in tabs.ts.
let toggleInFlight = false;

/** Mount target for modal overlays. Using #modal-root inside #app-frame means
 *  overlays get clipped by the frame's border-radius (since #app-frame has
 *  transform: translateZ(0) it becomes the containing block for position:fixed
 *  descendants). Falls back to body if the host is somehow missing. */
function modalHost(): HTMLElement {
  return document.getElementById("modal-root") ?? document.body;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initSettings(_terminalArea: HTMLElement): void {
  // Kept for API compat — the old settings mounted into the terminal area.
  // Modal settings attach to document.body, so no setup needed here.
}

export async function toggleSettings(): Promise<void> {
  if (toggleInFlight) return;
  toggleInFlight = true;
  // Reset on the next animation frame — long enough to swallow a paired
  // menu-event/keydown dispatch from a single Cmd+, press, short enough
  // that an intentional second press still toggles.
  requestAnimationFrame(() => { toggleInFlight = false; });
  if (visible) hideSettings();
  else await showSettings();
}

export async function openSettingsToCategory(cat: SettingsCategory): Promise<void> {
  activeCategory = cat;
  if (!visible) await showSettings();
  else render();
}

export function hideSettings(): void {
  visible = false;
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  panelEl = null;
  sideEl = null;
  mainEl = null;
  setKimboInConsoleView(true);
  if (themesEventUnlisten) { themesEventUnlisten(); themesEventUnlisten = null; }
  if (escapeHandler) { document.removeEventListener("keydown", escapeHandler, true); escapeHandler = null; }
  communityResolved = false;
  communityCatalogSize = 0;
  themeSearchQuery = "";
}

export function isSettingsVisible(): boolean {
  return visible;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

async function showSettings(): Promise<void> {
  if (visible) return;
  visible = true;
  kimboBus.emit({ type: "settings-open" });
  setKimboInConsoleView(false);

  try { config = await invoke<AppConfig>("get_config"); }
  catch (e) { console.error("get_config failed:", e); return; }

  overlayEl = document.createElement("div");
  overlayEl.className = "modal-overlay";
  // Tauri drag region — mousedown on the blurred backdrop drags the window.
  // The inner .settings panel is NOT given this attribute, so controls
  // inside the panel stay clickable. The CSS `-webkit-app-region: drag`
  // property is unreliable when combined with backdrop-filter on WKWebView,
  // so we rely on the Tauri attribute which already works for the title bar.
  overlayEl.setAttribute("data-tauri-drag-region", "");
  // Discriminate between click (close) and window-drag (keep open). Under
  // Tauri's data-tauri-drag-region, macOS starts a native window drag on
  // mousedown and the window follows the pointer — so clientX/clientY stay
  // PINNED relative to the window during and after the drag. Only
  // screenX/screenY track actual pointer movement, so that's what we
  // compare against to tell a drag apart from a real click.
  let downScreenX = 0, downScreenY = 0;
  overlayEl.addEventListener("mousedown", (e) => {
    downScreenX = e.screenX;
    downScreenY = e.screenY;
  });
  overlayEl.addEventListener("click", (e) => {
    if (e.target !== overlayEl) return;
    const dx = Math.abs(e.screenX - downScreenX);
    const dy = Math.abs(e.screenY - downScreenY);
    if (dx > 4 || dy > 4) return;
    hideSettings();
  });
  modalHost().appendChild(overlayEl);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      hideSettings();
    }
  };
  document.addEventListener("keydown", escapeHandler, true);

  render();

  // Attach the community-ready listener BEFORE invoking list_unified_themes.
  // The backend's list_unified_themes spawns a task that can emit the event
  // as soon as it runs — if the cache is warm this may happen before our
  // awaited invoke resumes. Registering late drops those emits and the
  // gallery stays stuck on "Loading community themes…".
  let eventReceived = false;
  if (themesEventUnlisten) { themesEventUnlisten(); themesEventUnlisten = null; }
  try {
    themesEventUnlisten = await listen<{ themes: UnifiedTheme[]; community_catalog_size: number; community_resolved: boolean }>(
      "themes://community-ready",
      (e) => {
        eventReceived = true;
        unifiedThemes = e.payload.themes;
        communityCatalogSize = e.payload.community_catalog_size;
        communityResolved = e.payload.community_resolved;
        // renderActive(), NOT render(): render() does overlayEl.innerHTML = ""
        // and rebuilds .settings, replaying its `rise-in` animation — the user
        // perceives the panel popping in a second time. renderActive() swaps
        // only the .main content in place. Same no-replay rule as nav clicks.
        if (visible && activeCategory === "appearance") renderActive();
      },
    );
  } catch (_) { /* ignore */ }

  // Async themes load; community resolves via the event above. The event
  // payload is strictly richer than this invoke's return value (local +
  // community), so if the event already fired we skip the assignment —
  // otherwise we'd clobber the community data with a locals-only list.
  const active = config?.theme.name ?? "";
  try {
    const local = await invoke<UnifiedTheme[]>("list_unified_themes", { activeSlug: active });
    if (!eventReceived) {
      unifiedThemes = local;
      // renderActive() not render() — see the community-ready handler above.
      // On a cold cache this path fires AFTER the initial render has already
      // animated .settings in; a full render() here replays `rise-in` and is
      // the long-standing "settings pops in twice on first open" bug.
      if (activeCategory === "appearance") renderActive();
    }
  } catch (e) { console.warn("list_unified_themes:", e); }
}

function render(): void {
  if (!overlayEl || !config) return;
  overlayEl.innerHTML = "";

  panelEl = document.createElement("div");
  panelEl.className = "settings";
  panelEl.addEventListener("click", (e) => e.stopPropagation());

  // Sidebar
  sideEl = document.createElement("div");
  sideEl.className = "side";

  const head = document.createElement("div");
  head.className = "side-head";
  head.textContent = "Settings";
  sideEl.appendChild(head);

  for (const n of NAV) {
    const btn = document.createElement("button");
    btn.className = "nav" + (activeCategory === n.id ? " active" : "");
    btn.type = "button";
    btn.dataset.navId = n.id;
    const ic = document.createElement("span");
    ic.className = "ic";
    ic.appendChild(icon(n.icon, 13));
    btn.appendChild(ic);
    const lbl = document.createElement("span");
    lbl.textContent = n.label;
    btn.appendChild(lbl);
    if (n.id === "about" && hasPendingUpdate()) {
      const dot = document.createElement("span");
      dot.className = "badge";
      dot.title = "Update available";
      btn.appendChild(dot);
    }
    btn.addEventListener("click", () => {
      if (activeCategory === n.id) return;
      activeCategory = n.id;
      // Refresh just the main content + the active class on the sidebar.
      // Recreating .settings here would replay the rise-in animation and
      // the user perceives it as the modal flashing closed and reopening.
      renderActive();
    });
    sideEl.appendChild(btn);
  }

  const foot = document.createElement("div");
  foot.className = "side-foot";
  const close = document.createElement("button");
  close.className = "close-btn";
  close.type = "button";
  close.textContent = "Close · esc";
  close.addEventListener("click", hideSettings);
  foot.appendChild(close);
  sideEl.appendChild(foot);

  // Main
  mainEl = document.createElement("div");
  mainEl.className = "main";
  renderActive();

  panelEl.appendChild(sideEl);
  panelEl.appendChild(mainEl);
  overlayEl.appendChild(panelEl);
}

/** Re-render the active category into the existing .main element and
 *  update the sidebar's active class. Keeps .modal-overlay and .settings
 *  in place so their CSS animations don't replay. */
function renderActive(): void {
  if (!mainEl || !sideEl) return;
  for (const btn of sideEl.querySelectorAll<HTMLButtonElement>(".nav")) {
    btn.classList.toggle("active", btn.dataset.navId === activeCategory);
  }
  mainEl.innerHTML = "";
  switch (activeCategory) {
    case "general":     renderGeneral(mainEl); break;
    case "appearance":  renderAppearance(mainEl); break;
    case "font":        renderFont(mainEl); break;
    case "workspaces":  renderWorkspaces(mainEl); break;
    case "keybinds":    renderKeybinds(mainEl); break;
    case "kimbo":       void renderKimbo(mainEl); break;
    case "claude-code": void renderClaudeCode(mainEl); break;
    case "advanced":    renderAdvanced(mainEl); break;
    case "about":       void renderAbout(mainEl); break;
  }
}

// ===========================================================================
// General
// ===========================================================================

function renderGeneral(el: HTMLElement): void {
  if (!config) return;
  el.appendChild(header("General", "Window behavior and startup preferences."));

  const prefs = getPrefs();

  const startup = section("Startup");
  startup.appendChild(row(
    "Open on launch",
    "What Kimbo does when you open it.",
    select(prefs.startup, [
      ["last", "Restore last session"],
      ["home", "Home directory"],
      ["workspace", "Last workspace"],
    ], (v) => setPref("startup", v as typeof prefs.startup)),
  ));
  startup.appendChild(row(
    "Default shell",
    `Detected at ${config.general.default_shell || "/bin/zsh"}`,
    select(detectShell(config.general.default_shell), [
      ["zsh", "zsh"],
      ["bash", "bash"],
      ["fish", "fish"],
      ["nushell", "nushell"],
    ], (v) => { config!.general.default_shell = expandShell(v); void saveConfig(); }),
  ));
  startup.appendChild(row(
    "Confirm before quit with active panes",
    "Asks before closing a window with running processes.",
    toggle(prefs.confirmQuit, (v) => setPref("confirmQuit", v)),
  ));

  const welcomeRowEl = row(
    "Show welcome on startup",
    "Show the keyboard-shortcut intro when Kimbo launches.",
    toggle(config.welcome.show_on_startup, async (v) => {
      config!.welcome.show_on_startup = v;
      await saveConfig();
    }),
  );
  startup.appendChild(welcomeRowEl);
  const showNow = button("Show welcome now", () => showWelcome());
  showNow.className = "btn ghost";
  const showRow = row("Preview welcome popup", "Opens the first-run popup right now.", showNow);
  startup.appendChild(showRow);

  el.appendChild(startup);

  const windowSec = section("Window");
  windowSec.appendChild(row(
    "Background opacity",
    "Lower values make the window translucent.",
    withComingSoon(range(prefs.backgroundOpacity, 0, 100, 1,
      (v) => setPref("backgroundOpacity", v)), !isMacOS()),
  ));
  windowSec.appendChild(row(
    "Transparent black bg",
    "When on, CLI tools that emit green-on-black labels render against the window's translucent background instead of solid dark rectangles.",
    toggle(prefs.transparentBlackBg, (v) => setPref("transparentBlackBg", v)),
  ));
  el.appendChild(windowSec);

  const bellSec = section("Bell");
  bellSec.appendChild(row(
    "Flash on bell",
    "Briefly flash the pane when a BEL character (0x07) is received.",
    toggle(prefs.bellVisual, (v) => setPref("bellVisual", v)),
  ));
  bellSec.appendChild(row(
    "Play sound on bell",
    "Play a short beep when a BEL character is received.",
    toggle(prefs.bellSound, (v) => setPref("bellSound", v)),
  ));
  el.appendChild(bellSec);
}

function detectShell(path: string): string {
  if (path.endsWith("fish")) return "fish";
  if (path.endsWith("bash")) return "bash";
  if (path.endsWith("nushell") || path.endsWith("nu")) return "nushell";
  return "zsh";
}
function expandShell(name: string): string {
  switch (name) {
    case "fish": return "/usr/local/bin/fish";
    case "bash": return "/bin/bash";
    case "nushell": return "/usr/local/bin/nu";
    default: return "/bin/zsh";
  }
}

// ===========================================================================
// Appearance
// ===========================================================================

function renderAppearance(el: HTMLElement): void {
  if (!config) return;
  el.appendChild(header(
    "Appearance",
    "Themes ship as self-contained packages. Community themes install from the gallery.",
  ));

  const active = config.theme.name;

  // Theme section
  const themeSec = section("Theme");
  themeSec.classList.add("themes");

  const yoursAll = unifiedThemes.filter((t) => t.source !== "Available");
  const availableAll = unifiedThemes.filter((t) => t.source === "Available");

  // Grid containers. `galleryContainer` is assigned later when the
  // Community gallery section is built; we declare it up front so the
  // rebuild closure (created next) captures a stable binding.
  const yoursContainer = document.createElement("div");
  let galleryContainer: HTMLElement | null = null;

  function emptyMsg(text: string): HTMLElement {
    const d = document.createElement("div");
    d.style.cssText = "color: var(--fg-muted); font-size: 12px; padding: 6px 0;";
    d.textContent = text;
    return d;
  }

  function buildYoursInto(container: HTMLElement): void {
    const mode = getPrefs().themePickerMode;
    const filtered = filterThemes(yoursAll, themeSearchQuery, mode);
    container.replaceChildren();
    if (yoursAll.length === 0) {
      container.appendChild(emptyMsg("Loading themes…"));
      return;
    }
    if (filtered.length === 0) {
      container.appendChild(emptyMsg("No themes match your search."));
      return;
    }
    const grid = document.createElement("div");
    grid.className = "theme-grid";
    for (const t of filtered) grid.appendChild(themeCard(t, t.slug === active));
    container.appendChild(grid);
  }

  function buildAvailableInto(container: HTMLElement): void {
    const mode = getPrefs().themePickerMode;
    const filtered = filterThemes(availableAll, themeSearchQuery, mode);
    container.replaceChildren();
    if (!communityResolved) {
      container.appendChild(emptyMsg("Loading community themes…"));
      return;
    }
    if (communityCatalogSize === 0) {
      container.appendChild(emptyMsg("Community themes unavailable (offline?)"));
      return;
    }
    if (availableAll.length === 0) {
      const n = communityCatalogSize;
      const noun = n === 1 ? "theme" : "themes";
      const verb = n === 1 ? "is" : "are";
      container.appendChild(emptyMsg(
        `All ${n} community ${noun} ${verb} installed. Uninstall any theme above (hover → ×) to see it in the gallery again.`,
      ));
      return;
    }
    if (filtered.length === 0) {
      container.appendChild(emptyMsg("No themes match your search."));
      return;
    }
    const grid = document.createElement("div");
    grid.className = "theme-grid";
    for (const t of filtered) grid.appendChild(themeCard(t, false));
    container.appendChild(grid);
  }

  // Defined as a function declaration so it's hoisted — safe to reference
  // from the search input + mode dropdown callbacks even though they're
  // attached before galleryContainer is assigned.
  function rebuildGrids(): void {
    buildYoursInto(yoursContainer);
    if (galleryContainer) buildAvailableInto(galleryContainer);
  }

  // Search + mode controls row.
  const controlsRow = document.createElement("div");
  controlsRow.style.cssText = "display: flex; gap: 8px; align-items: center; margin-bottom: 10px;";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "input";
  searchInput.placeholder = "Search themes by name, author, or color…";
  searchInput.value = themeSearchQuery;
  searchInput.style.flex = "1";
  searchInput.spellcheck = false;
  searchInput.autocapitalize = "off";
  searchInput.autocomplete = "off";
  searchInput.addEventListener("input", () => {
    themeSearchQuery = searchInput.value;
    rebuildGrids();
  });
  controlsRow.appendChild(searchInput);

  const modeCtl = segCtl(
    getPrefs().themePickerMode,
    [["all", "All"], ["dark", "Dark"], ["light", "Light"]],
    (v) => {
      setPref("themePickerMode", v as ThemeMode);
      rebuildGrids();
    },
  );
  controlsRow.appendChild(modeCtl);
  themeSec.appendChild(controlsRow);

  themeSec.appendChild(yoursContainer);
  buildYoursInto(yoursContainer);

  // Accent / density / tab style
  const accentSec = section("Accent");
  const prefs = getPrefs();
  const accentPicker = document.createElement("div");
  accentPicker.className = "swatches";
  const PRESET_ACCENTS = ["#8aa9ff", "#f38ba8", "#a6e3a1", "#f9e2af", "#cba6f7", "#7dcfff"];
  const isPreset = (c: string): boolean =>
    c === "" || PRESET_ACCENTS.includes(c.toLowerCase());

  // Theme-default swatch
  const defaultSw = document.createElement("button");
  defaultSw.type = "button";
  defaultSw.className = "swatch" + (prefs.accent === "" ? " selected" : "");
  defaultSw.style.background = "var(--accent)";
  defaultSw.textContent = "A";
  defaultSw.title = "Theme default";
  defaultSw.addEventListener("click", () => {
    setPref("accent", "");
    render();
  });
  accentPicker.appendChild(defaultSw);

  // Preset swatches
  for (const c of PRESET_ACCENTS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className =
      "swatch" + (prefs.accent.toLowerCase() === c ? " selected" : "");
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener("click", () => {
      setPref("accent", c);
      render();
    });
    accentPicker.appendChild(sw);
  }

  // Custom-color swatch
  const customActive = !isPreset(prefs.accent);
  const customSw = document.createElement("button");
  customSw.type = "button";
  customSw.className =
    "swatch swatch-custom" + (customActive ? " selected" : "");
  if (customActive) customSw.style.background = prefs.accent;
  customSw.title = customActive ? `Custom: ${prefs.accent}` : "Custom color…";
  customSw.addEventListener("click", () => {
    openCustomAccentPopover(customSw, prefs.accent);
  });
  accentPicker.appendChild(customSw);
  accentSec.appendChild(row(
    "Accent color",
    "Overrides the theme's accent. Used for selection, active tab, and highlights.",
    accentPicker,
  ));
  accentSec.appendChild(row(
    "Density",
    "Affects padding and row heights across the UI.",
    segCtl(prefs.density, [
      ["compact", "Compact"],
      ["comfortable", "Comfortable"],
      ["roomy", "Roomy"],
    ], (v) => setPref("density", v as Density)),
  ));
  accentSec.appendChild(row(
    "Tab style",
    "",
    segCtl(prefs.tabStyle, [
      ["underline", "Underline"],
      ["pill", "Pill"],
      ["chevron", "Chevron"],
    ], (v) => setPref("tabStyle", v as TabStyle)),
  ));
  el.appendChild(accentSec);

  // Notifications section — toast placement. Sits above Theme so that Theme
  // and Community gallery stay adjacent; they read as one unit.
  const toastCfg = config.toast;
  const notifySec = section("Notifications");
  notifySec.appendChild(row(
    "Notification position",
    "Where notifications appear in the window.",
    select(toastCfg.position, [
      ["bottom", "Bottom"],
      ["top", "Top"],
    ], async (v) => {
      toastCfg.position = v;
      await saveConfig();
      const { setToastPosition, normalizeToastPosition } = await import("./toast");
      setToastPosition(normalizeToastPosition(v));
    }),
  ));
  el.appendChild(notifySec);

  el.appendChild(themeSec);

  // Community gallery
  const gallery = section("Community gallery");
  gallery.classList.add("gallery");
  galleryContainer = document.createElement("div");
  gallery.appendChild(galleryContainer);
  buildAvailableInto(galleryContainer);
  el.appendChild(gallery);

  // Page-level theme actions, pinned to the bottom of the Appearance page.
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 24px;";
  const create = button("Create theme…", () => {
    void openUrl("https://github.com/lucatescari/kimbo-terminal/blob/main/docs/themes.md");
  });
  create.classList.add("ghost");
  btnRow.appendChild(create);
  const importBtn = button("Import from file", async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Kimbo theme", extensions: ["json"] }],
        title: "Import Kimbo theme",
      });
      if (typeof selected !== "string") return; // user cancelled
      await invoke<string>("install_theme_from_file", {
        filePath: selected,
        activeSlug: config?.theme.name ?? null,
      });
      // The rust command spawns an emit of `themes://community-ready` which
      // the gallery listener already picks up; nothing else to do here.
    } catch (e) {
      alert(`Could not import theme:\n\n${e instanceof Error ? e.message : String(e)}`);
    }
  });
  importBtn.classList.add("ghost");
  btnRow.appendChild(importBtn);
  el.appendChild(btnRow);
}

/** Wrap buildThemeCard with the install / activate / uninstall plumbing
 *  specific to the settings panel. Logic lives in theme-card.ts (which is
 *  unit-tested); this just bridges those callbacks to invoke() and updates
 *  to in-memory state. */
function themeCard(t: UnifiedTheme, active: boolean): HTMLElement {
  return buildThemeCard(t, { active }, {
    onActivate: async (slug) => {
      try {
        if (!config) return;
        config.theme.name = slug;
        await saveConfig();
        await loadTheme(slug);
        if (activeCategory === "appearance") render();
      } catch (e) { console.error("activate theme failed:", e); }
    },
    onInstall: async (slug) => {
      try {
        await invoke("install_theme", { slug, activeSlug: config?.theme.name ?? "" });
        if (!config) return;
        config.theme.name = slug;
        await saveConfig();
        await loadTheme(slug);
        // Don't refetch the list — install_theme already spawns emit_full_list,
        // and the themes://community-ready listener will push the updated
        // state. A manual refetch here would race and clobber Available.
        if (activeCategory === "appearance") render();
      } catch (e) { console.error("install theme failed:", e); }
    },
    onUninstall: async (slug) => {
      try {
        // The backend refuses to delete the currently-active theme — it
        // would leave the app pointing at a missing file. If the user is
        // uninstalling the active theme, switch to kimbo-dark FIRST so the
        // delete proceeds. Without this the delete is a silent no-op
        // (alert() is broken in Tauri 2 without the dialog plugin).
        if (config && config.theme.name === slug) {
          console.warn(`uninstall: '${slug}' is active; switching to kimbo-dark first`);
          config.theme.name = "kimbo-dark";
          await saveConfig();
          await loadTheme("kimbo-dark");
        }
        await invoke("delete_theme", { slug, activeSlug: config?.theme.name ?? "" });
      } catch (err) {
        // alert() is silently swallowed by Tauri 2 (no dialog plugin), so
        // route to console.error which surfaces in devtools — at least
        // there's a visible signal when something goes wrong.
        console.error(`uninstall '${slug}' failed:`, err);
      }
    },
    onAuthorClick: async (username) => {
      try { await openUrl(`https://github.com/${username}`); } catch (_) { /* ignore */ }
    },
  });
}

// ===========================================================================
// Font
// ===========================================================================

const COMMON_MONOSPACE_FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "Hack",
  "IBM Plex Mono",
  "Ubuntu Mono",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
];

function renderFont(el: HTMLElement): void {
  if (!config) return;
  el.appendChild(header("Font", "Controls terminal font only. UI font is set by the active theme."));

  const family = config.font.family;
  const options = COMMON_MONOSPACE_FONTS.includes(family) ? COMMON_MONOSPACE_FONTS : [family, ...COMMON_MONOSPACE_FONTS];

  // Keep the preview element in sync without re-rendering the whole pane —
  // the user expects immediate visual feedback when they tweak font / size /
  // line-height, otherwise the preview looks broken. The updaters are set
  // below once the preview element exists; these wrappers capture them by
  // reference so the callbacks above can fire them whether the preview has
  // been built yet or not.
  let updatePreview: () => void = () => {};

  const familySec = section("Family");
  familySec.appendChild(row("Terminal font", "",
    select(family, options.map((f) => [f, f]), (v) => {
      config!.font.family = v;
      void saveConfig();
      updatePreview();
    }),
  ));
  familySec.appendChild(row("Size", "12–20px works well on retina displays.",
    numInput(config.font.size, 8, 40, 0.5, (v) => {
      config!.font.size = v;
      void saveConfig();
      updatePreview();
    }),
  ));
  familySec.appendChild(row("Line height", "",
    numInput(config.font.line_height, 1.0, 2.5, 0.05, (v) => {
      config!.font.line_height = v;
      void saveConfig();
      updatePreview();
    }),
  ));
  el.appendChild(familySec);

  const rendering = section("Rendering");
  rendering.appendChild(row("Enable ligatures", "Renders →, =>, ≠, etc. as glyphs.",
    toggle(config.font.ligatures, (v) => {
      config!.font.ligatures = v;
      void saveConfig();
      const fp = el.querySelector(".font-preview");
      if (fp) fp.classList.toggle("lig", v);
    }),
  ));
  el.appendChild(rendering);

  // Preview
  const previewSec = section("Preview");
  const preview = document.createElement("div");
  preview.className = "font-preview" + (config.font.ligatures ? " lig" : "");
  preview.innerHTML = `
    <div><span class="fp-prompt">luca</span> <span class="fp-branch">(fix/cmd-w)</span> <span class="fp-dim">~/kimbo</span> <span class="fp-prompt">$</span> npm test</div>
    <div><span class="fp-dim">const</span> greet = (name) =&gt; <span class="fp-ok">\`hello, \${name}\`</span>;</div>
    <div class="fp-ok">  ✓ 321 tests passed</div>
    <div class="fp-err">  ✗ 0 failed · 0 skipped</div>
    <div class="fp-dim">  abc ABC 0123456789 === !== &amp;&amp; || -&gt; =&gt;</div>
  `;
  updatePreview = () => {
    if (!config) return;
    preview.style.fontFamily = `"${config.font.family}", ui-monospace, Menlo, monospace`;
    preview.style.fontSize = `${config.font.size}px`;
    preview.style.lineHeight = String(config.font.line_height);
  };
  updatePreview();
  previewSec.appendChild(preview);
  el.appendChild(previewSec);
}

// ===========================================================================
// Workspaces
// ===========================================================================

function renderWorkspaces(el: HTMLElement): void {
  if (!config) return;
  el.appendChild(header("Workspaces", "Group tabs by project. Auto-detection scans the directories below."));

  const sec = section("Auto-detection");
  sec.appendChild(row(
    "Auto-detect projects",
    "Kimbo scans listed folders for Git repos and shows them under ⌘K → Open project…",
    toggle(config.workspace.auto_detect, (v) => {
      config!.workspace.auto_detect = v;
      void saveConfig();
    }),
  ));
  el.appendChild(sec);

  const listSec = section("Scan directories");
  const list = document.createElement("div");
  list.className = "ws-list";

  const dirs = config.workspace.scan_dirs;
  dirs.forEach((dir, i) => {
    const r = document.createElement("div");
    r.className = "ws-row";

    const ic = document.createElement("div");
    ic.className = "icon";
    ic.textContent =
      dir.replace(/^~/, "").split("/").filter(Boolean)[0]?.[0]?.toUpperCase() || "·";
    r.appendChild(ic);

    const info = document.createElement("div");
    info.style.display = "flex";
    info.style.flexDirection = "column";
    info.style.minWidth = "0";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = dir.split("/").filter(Boolean).pop() || "~";
    const path = document.createElement("div");
    path.className = "path";
    path.textContent = dir;
    // Show the full path as a tooltip too — the muted row text truncates
    // visually and long project paths become unreadable otherwise.
    path.title = dir;
    info.appendChild(title);
    info.appendChild(path);
    r.appendChild(info);

    // Action cluster: up, down, change, remove. Up/down are plain icon
    // buttons (no text) to keep the row short; `.ws-move` below gives them
    // a hover treatment. Disable endpoint moves so clicking ↑ on the top
    // row isn't a no-op that looks broken.
    const actions = document.createElement("div");
    actions.className = "ws-actions";

    const up = iconBtn("chevron-u", "Move up", () => {
      if (i === 0) return;
      [dirs[i - 1], dirs[i]] = [dirs[i], dirs[i - 1]];
      void saveConfig();
      render();
    });
    if (i === 0) up.setAttribute("disabled", "");
    actions.appendChild(up);

    const down = iconBtn("chevron-d", "Move down", () => {
      if (i === dirs.length - 1) return;
      [dirs[i + 1], dirs[i]] = [dirs[i], dirs[i + 1]];
      void saveConfig();
      render();
    });
    if (i === dirs.length - 1) down.setAttribute("disabled", "");
    actions.appendChild(down);

    const change = button("Change…", async () => {
      try {
        const picked = await openFileDialog({
          multiple: false,
          directory: true,
          title: "Pick a workspace directory",
        });
        if (typeof picked !== "string") return;
        dirs[i] = picked;
        void saveConfig();
        render();
      } catch (e) {
        console.warn("[kimbo.workspace] change-directory picker failed:", e);
      }
    });
    change.classList.add("ghost", "small");
    actions.appendChild(change);

    const rm = button("Remove", () => {
      dirs.splice(i, 1);
      void saveConfig();
      render();
    });
    rm.classList.add("ghost", "small");
    actions.appendChild(rm);

    r.appendChild(actions);
    list.appendChild(r);
  });
  listSec.appendChild(list);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 12px;";
  const add = button("Add directory", async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: true,
        title: "Add a workspace directory",
      });
      if (typeof picked !== "string") return;
      // De-dupe — adding the same path twice just wastes a scan.
      if (!dirs.includes(picked)) dirs.push(picked);
      void saveConfig();
      render();
    } catch (e) {
      console.warn("[kimbo.workspace] add-directory picker failed:", e);
    }
  });
  add.classList.add("primary");
  add.prepend(icon("plus", 12));
  btnRow.appendChild(add);
  listSec.appendChild(btnRow);

  el.appendChild(listSec);
}

// ===========================================================================
// Keybinds
// ===========================================================================

function keybindToast(message: string): void {
  void import("./toast").then(({ showToast }) => showToast({ kind: "info", message }));
}

/** Push a rebind to the right layer + persist. Menu-owned actions update the
 *  native macOS menu accelerator via Rust (the menu, not the webview, owns
 *  those keys); webview actions take effect live via the registry override. */
function persistKeybinding(id: string, chord: string | null): void {
  if (chord) setOverride(id, chord);
  if (config) {
    config.keybindings = config.keybindings ?? { bindings: {} };
    config.keybindings.bindings = { ...overrides() };
    void saveConfig();
  }
  if (isMenuAction(id)) {
    // chord=null → fall back to the action's default for the menu accelerator.
    const effective = chord ?? activeChord(id);
    invoke("set_menu_accelerator", { id, chord: effective }).catch((e) =>
      console.error("set_menu_accelerator failed:", e),
    );
  }
}

/** Human-friendly section headings for the keybind categories. */
const CATEGORY_LABELS: Record<ActionDef["category"], string> = {
  tabs: "Tabs",
  panes: "Panes",
  nav: "Navigation",
  edit: "Editing",
  app: "Application",
};

function renderKeybinds(el: HTMLElement): void {
  el.appendChild(header(
    "Keybinds",
    "Click any shortcut to rebind it. Every shortcut must include ⌘.",
  ));

  // Sections are rebuilt into this container so a rebind re-renders the whole
  // grouped list in one place.
  const groups = document.createElement("div");
  let capturing = false;

  function fillChip(chip: HTMLElement, chord: string): void {
    chip.replaceChildren();
    for (const k of chordToDisplayParts(chord)) {
      const s = document.createElement("span");
      s.textContent = k;
      chip.appendChild(s);
    }
  }

  function beginCapture(a: ActionDef, chip: HTMLElement): void {
    if (capturing) return;
    capturing = true;
    chip.classList.add("capturing");
    chip.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "kbd-chip-hint";
    hint.textContent = "Press keys…";
    chip.appendChild(hint);

    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      capturing = false;
      rebuild();
    };

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { finish(); return; }
      if (["Meta", "Shift", "Control", "Alt", "CapsLock"].includes(e.key)) return;

      const chord = chordFromEvent(e);
      if (!chord) { keybindToast("Shortcuts must include ⌘"); finish(); return; }

      const owner = actionForChord(chord);
      if (owner && owner !== a.id) {
        const ownerLabel = ACTIONS.find((x) => x.id === owner)?.label ?? owner;
        keybindToast(`${chordToDisplayParts(chord).join("")} is already bound to ${ownerLabel}`);
        finish();
        return;
      }
      persistKeybinding(a.id, chord);
      finish();
    };

    // window + capture so this runs before settings' own Escape handler — Escape
    // cancels capture without also closing the modal.
    window.addEventListener("keydown", onKey, true);
  }

  function rebuild(): void {
    groups.replaceChildren();
    // Group actions by category, preserving the order each category first
    // appears in ACTIONS so the sections stay in a deliberate sequence.
    const order: ActionDef["category"][] = [];
    const byCategory = new Map<ActionDef["category"], ActionDef[]>();
    for (const a of ACTIONS) {
      if (!byCategory.has(a.category)) { byCategory.set(a.category, []); order.push(a.category); }
      byCategory.get(a.category)!.push(a);
    }

    for (const cat of order) {
      const sec = section(CATEGORY_LABELS[cat] ?? cat);
      const table = document.createElement("div");
      table.className = "keytable";
      for (const a of byCategory.get(cat)!) {
        // The whole row is the click target — click anywhere on it to rebind.
        const r = document.createElement("button");
        r.type = "button";
        r.className = "krow";
        r.dataset.actionId = a.id;
        const left = document.createElement("div");
        left.textContent = a.label;
        r.appendChild(left);

        const chip = document.createElement("span");
        chip.className = "kbd-chip";
        fillChip(chip, activeChord(a.id));
        r.appendChild(chip);

        r.addEventListener("click", () => beginCapture(a, chip));
        table.appendChild(r);
      }
      sec.appendChild(table);
      groups.appendChild(sec);
    }
  }

  rebuild();
  el.appendChild(groups);

  const foot = document.createElement("div");
  foot.style.cssText = "margin-top: 4px;";
  const reset = button("Reset to defaults", () => {
    resetOverrides();
    if (config) { config.keybindings = { bindings: {} }; void saveConfig(); }
    // Restore every menu accelerator to its default.
    for (const a of ACTIONS) {
      if (a.menu) {
        invoke("set_menu_accelerator", { id: a.id, chord: a.defaultChord }).catch((e) =>
          console.error("set_menu_accelerator failed:", e),
        );
      }
    }
    rebuild();
  });
  reset.classList.add("ghost");
  foot.appendChild(reset);
  el.appendChild(foot);
}

// ===========================================================================
// Kimbo
// ===========================================================================

async function renderKimbo(el: HTMLElement): Promise<void> {
  if (!config) return;
  el.appendChild(header(
    "Kimbo widget",
    "The tiny helper overlay that reacts to your shell and surfaces agent activity.",
  ));

  const kimbo = config.kimbo;

  const widget = section("Widget");
  widget.appendChild(row(
    "Show Kimbo",
    "Hides the mascot without disabling the Kimbo system (shell integration, events).",
    toggle(kimbo.enabled, async (v) => {
      kimbo.enabled = v;
      await saveConfig();
      setKimboEnabled(v);
    }),
  ));
  widget.appendChild(row(
    "Corner",
    "Where Kimbo docks inside the focused pane.",
    select(kimbo.corner, [
      ["bottom_right", "Bottom right"],
      ["bottom_left", "Bottom left"],
      ["top_right", "Top right"],
      ["top_left", "Top left"],
    ], async (v) => {
      kimbo.corner = v;
      await saveConfig();
      setKimboCorner(v as any);
    }),
  ));
  const chip = document.createElement("span");
  chip.className = "kbd-chip";
  for (const k of ["⌃", "T"]) {
    const s = document.createElement("span");
    s.textContent = k;
    chip.appendChild(s);
  }
  widget.appendChild(row("Hide shortcut", "Temporarily hide Kimbo for this session.", chip));
  el.appendChild(widget);

  const shell = section("Shell integration");
  const desc = document.createElement("p");
  desc.style.cssText = "color: var(--fg-muted); line-height: 1.5; font-size: 13px; margin: 0 0 14px;";
  desc.innerHTML = `Lets Kimbo react to command success (<span style="color: var(--success)">happy</span>) and failure (<span style="color: var(--danger)">sad</span>), show live status, and pick up cwd changes.`;
  shell.appendChild(desc);

  shell.appendChild(row(
    "Enable shell integration",
    "",
    toggle(kimbo.shell_integration, async (v) => {
      kimbo.shell_integration = v;
      await saveConfig();
      setKimboShellIntegration(v);
      // Re-render so code block shows/hides.
      render();
    }),
  ));

  if (kimbo.shell_integration) {
    try {
      const shellDir = await invoke<string>("write_kimbo_shell_scripts");
      const shellPath = config.general.default_shell || "/bin/zsh";
      const snippetFile = shellPath.endsWith("fish") ? "kimbo-init.fish"
        : shellPath.endsWith("bash") ? "kimbo-init.bash"
        : "kimbo-init.zsh";
      const rcLine = `source ${shellDir}/${snippetFile}`;

      const block = document.createElement("div");
      block.className = "codeblock";

      const hint = document.createElement("div");
      hint.className = "hint";
      hint.innerHTML = `Add this line to your shell rc (detected: <b style="color: var(--fg)">${snippetFile}</b>)`;
      block.appendChild(hint);

      const cr = document.createElement("div");
      cr.className = "code-row";
      const pre = document.createElement("pre");
      pre.textContent = rcLine;
      cr.appendChild(pre);
      const copy = button("Copy", async () => {
        try { await navigator.clipboard.writeText(rcLine); copy.textContent = "Copied"; }
        catch { copy.textContent = "Copy failed"; }
        setTimeout(() => { copy.innerHTML = ""; copy.appendChild(icon("copy", 11)); copy.appendChild(document.createTextNode(" Copy")); }, 1500);
      });
      copy.innerHTML = "";
      copy.appendChild(icon("copy", 11));
      copy.appendChild(document.createTextNode(" Copy"));
      cr.appendChild(copy);
      block.appendChild(cr);

      shell.appendChild(block);
    } catch (e) {
      const err = document.createElement("div");
      err.style.cssText = "color: var(--danger); font-size: 12px; margin-top: 8px;";
      err.textContent = `Failed to install shell scripts: ${e}`;
      shell.appendChild(err);
    }
  }

  el.appendChild(shell);
}

// ===========================================================================
// Claude Code
// ===========================================================================

async function renderClaudeCode(el: HTMLElement): Promise<void> {
  el.appendChild(header(
    "Claude Code",
    "Surface session info from <code>claude</code> in the pane chrome while it's running. All data is local — read from <code>~/.claude/</code> or <code>claude auth status</code>.",
  ));

  const prefs = getPrefs();

  const hudSec = section("HUD");
  hudSec.appendChild(row(
    "Show Claude HUD when claude is running",
    "Per-pane status strip below the pane head.",
    toggle(prefs.claudeHudEnabled, (v) => setPref("claudeHudEnabled", v)),
  ));
  hudSec.appendChild(row(
    "Show extended fields",
    "Append permission mode and message / tool counts.",
    toggle(prefs.claudeHudExtended, (v) => setPref("claudeHudExtended", v)),
  ));
  hudSec.appendChild(row(
    "Show subscription plan",
    "Append the plan tier (e.g. \"max\") after the email.",
    toggle(prefs.claudeHudShowPlan, (v) => setPref("claudeHudShowPlan", v)),
  ));
  hudSec.appendChild(row(
    "Show Claude rate limits",
    "Replaces tokens/cost with 5h and weekly limit percentages. Installs a tiny shim into your Claude Code config.",
    toggle(prefs.claudeRateLimitsEnabled === true, async (v) => {
      if (v) {
        const { installRateLimits } = await import("./claude-rate-limits");
        const { showToast } = await import("./toast");
        const outcome = await installRateLimits(true);
        if (outcome.kind === "Installed" || outcome.kind === "NoOp") {
          setPref("claudeRateLimitsEnabled", true);
          showToast({ kind: "success", message: "Rate-limit display enabled" });
        } else {
          console.warn("install pending despite force:", outcome);
        }
      } else {
        const { uninstallRateLimits } = await import("./claude-rate-limits");
        const { showToast } = await import("./toast");
        await uninstallRateLimits();
        setPref("claudeRateLimitsEnabled", false);
        showToast({ kind: "info", message: "Rate-limit display disabled" });
      }
    }),
  ));
  el.appendChild(hudSec);

  // ---- Notifications subsection ----
  const notifySec = section("Notifications");

  const notifyBothOff = prefs.notifyOnStop !== true && prefs.notifyOnPermission !== true;

  notifySec.appendChild(row(
    "Notify on turn finished",
    "macOS notification when Claude finishes a turn.",
    toggle(prefs.notifyOnStop === true, async (v) => {
      setPref("notifyOnStop", v);
      await syncHookInstall();
      render();
    }),
  ));
  notifySec.appendChild(row(
    "Notify on permission needed",
    "macOS notification when Claude is waiting for your approval.",
    toggle(prefs.notifyOnPermission === true, async (v) => {
      setPref("notifyOnPermission", v);
      await syncHookInstall();
      render();
    }),
  ));
  notifySec.appendChild(row(
    "Play sound on macOS notification",
    "Plays the default macOS alert sound with each notification.",
    toggle(prefs.notifySoundEnabled, (v) => setPref("notifySoundEnabled", v), notifyBothOff),
  ));

  // Status row — async: query hook install state and render a button.
  let installStatus: { kind: string; missing?: string[] } = { kind: "Unknown" };
  try {
    installStatus = await invoke<{ kind: string; missing?: string[] }>("claude_notifications_status");
  } catch (e) {
    console.warn("claude_notifications_status failed:", e);
  }

  const statusCtl = document.createElement("div");
  statusCtl.style.cssText = "display: flex; align-items: center; gap: 10px;";

  const statusLabel = document.createElement("span");
  statusLabel.style.cssText = "font-size: 12px; color: var(--fg-muted);";
  switch (installStatus.kind) {
    case "Installed":         statusLabel.textContent = "Installed"; break;
    case "PartiallyInstalled": statusLabel.textContent = `Partial (missing: ${installStatus.missing?.join(", ") ?? "?"})`; break;
    case "NotInstalled":      statusLabel.textContent = "Not installed"; break;
    default:                  statusLabel.textContent = "Unknown"; break;
  }
  statusCtl.appendChild(statusLabel);

  const actionBtnLabel =
    installStatus.kind === "Installed"            ? "Uninstall"
    : installStatus.kind === "PartiallyInstalled" ? "Reinstall"
    : "Install";
  const actionBtn = button(actionBtnLabel, async () => {
    actionBtn.disabled = true;
    actionBtn.textContent = actionBtnLabel === "Uninstall" ? "Uninstalling\u2026" : "Installing\u2026";
    try {
      if (actionBtnLabel === "Uninstall") {
        await invoke("claude_notifications_uninstall");
      } else {
        await invoke("claude_notifications_install");
        const { ensureNotificationPermission } = await import("./claude-notifications");
        void ensureNotificationPermission();
      }
    } catch (e) {
      const { showToast } = await import("./toast");
      showToast({ kind: "error", message: `Couldn't ${actionBtnLabel.toLowerCase()} Claude hooks`, detail: String(e) });
    }
    render();
  });
  actionBtn.classList.add("ghost", "small");
  statusCtl.appendChild(actionBtn);

  notifySec.appendChild(row(
    "Hooks install state",
    "Kimbo hooks into Claude Code\u2019s <code>Stop</code> and <code>Notification</code> events.",
    statusCtl,
  ));

  el.appendChild(notifySec);

  const accountSec = section("Account");
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "btn ghost";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing\u2026";
    try {
      const { refreshAccount } = await import("./claude-account");
      await refreshAccount();
      refreshBtn.textContent = "Refreshed \u2713";
      setTimeout(() => {
        refreshBtn.textContent = "Refresh";
        refreshBtn.disabled = false;
      }, 1500);
    } catch (e) {
      console.warn("refresh account failed:", e);
      refreshBtn.textContent = "Failed";
      setTimeout(() => {
        refreshBtn.textContent = "Refresh";
        refreshBtn.disabled = false;
      }, 1500);
    }
  });
  accountSec.appendChild(row(
    "Account info",
    "Re-runs <code>claude auth status</code>.",
    refreshBtn,
  ));
  el.appendChild(accountSec);
}

// ---------------------------------------------------------------------------
// syncHookInstall — called after toggling notifyOnStop / notifyOnPermission.
// Installs hooks when either notify pref is enabled, uninstalls when both off.
// ---------------------------------------------------------------------------

async function syncHookInstall(): Promise<void> {
  const prefs = getPrefs();
  const wantsHooks = prefs.notifyOnStop === true || prefs.notifyOnPermission === true;
  let status: { kind: string };
  try {
    status = await invoke<{ kind: string }>("claude_notifications_status");
  } catch (e) {
    console.warn("syncHookInstall: status query failed:", e);
    return;
  }
  if (wantsHooks && status.kind !== "Installed") {
    try {
      await invoke("claude_notifications_install");
    } catch (e) {
      const { showToast } = await import("./toast");
      showToast({ kind: "error", message: "Couldn't install Claude hooks", detail: String(e) });
    }
  } else if (!wantsHooks && status.kind !== "NotInstalled") {
    try {
      await invoke("claude_notifications_uninstall");
    } catch (e) {
      const { showToast } = await import("./toast");
      showToast({ kind: "error", message: "Couldn't uninstall Claude hooks", detail: String(e) });
    }
  }
}

// ===========================================================================
// Advanced
// ===========================================================================

function renderAdvanced(el: HTMLElement): void {
  if (!config) return;
  el.appendChild(header("Advanced", "Experimental flags and low-level behavior. Handle with care."));

  const perf = section("Performance");
  perf.appendChild(row(
    "Scrollback lines",
    "How many lines Kimbo keeps in memory per pane.",
    numInput(config.scrollback.lines, 1000, 200_000, 1000, (v) => {
      config!.scrollback.lines = v;
      void saveConfig();
    }, "num"),
  ));
  el.appendChild(perf);

  const cursor = section("Cursor");
  cursor.appendChild(row("Cursor style", "",
    segCtl(config.cursor.style, [
      ["block", "Block"],
      ["underline", "Underline"],
      ["bar", "Bar"],
    ], (v) => { config!.cursor.style = v; void saveConfig(); }),
  ));
  cursor.appendChild(row("Cursor blink", "",
    toggle(config.cursor.blink, (v) => { config!.cursor.blink = v; void saveConfig(); }),
  ));
  el.appendChild(cursor);

  const cfg = section("Config");
  cfg.appendChild(row(
    "Config file",
    "~/.config/kimbo/config.toml",
    button("Open in editor", async () => {
      try {
        await invoke("open_config_in_editor");
      } catch (e) {
        const path = await invoke<string>("get_config_path").catch(() => "~/.config/kimbo/config.toml");
        const { showToast } = await import("./toast");
        showToast({
          kind: "error",
          message: "Couldn't open config in editor",
          detail: `${path}\n${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),
  ));
  const resetBtn = button("Reset…", async () => {
    if (!confirm("Reset all settings to defaults? This cannot be undone.")) return;
    try {
      // Write defaults to config.toml (font/theme/cursor/scrollback/kimbo/
      // updates), wipe the localStorage UI prefs, then reload so everything
      // re-applies from defaults — no process restart needed.
      await invoke("reset_config");
      clearPrefs();
      window.location.reload();
    } catch (e) {
      const { showToast } = await import("./toast");
      showToast({
        kind: "error",
        message: "Couldn't reset settings",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
  resetBtn.classList.add("danger");
  cfg.appendChild(row(
    "Reset all settings",
    "Clears your preferences and restarts with defaults.",
    resetBtn,
  ));
  el.appendChild(cfg);

  const priv = section("Privacy");
  priv.appendChild(row(
    "Send anonymous crash reports",
    "Opt-in. Sends crashes and JS errors to Sentry — no command output, no terminal content, no machine name. Takes effect after a restart.",
    toggle(config.telemetry.enabled, (v) => {
      config!.telemetry.enabled = v;
      void saveConfig();
    }),
  ));
  el.appendChild(priv);
}

// ===========================================================================
// About
// ===========================================================================

async function renderAbout(el: HTMLElement): Promise<void> {
  if (!config) return;
  el.appendChild(header("About", ""));

  const info = getCachedUpdate();
  const currentVersion = info?.current ?? "unknown";

  const identity = document.createElement("div");
  identity.className = "about-identity";
  const logo = document.createElement("div");
  logo.className = "logo";
  identity.appendChild(logo);

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = "Kimbo";
  meta.appendChild(name);
  const version = document.createElement("div");
  version.className = "version";
  version.innerHTML = `Version ${escapeHtml(currentVersion)}`;
  meta.appendChild(version);
  const tagline = document.createElement("div");
  tagline.className = "tagline";
  tagline.textContent = "A fast, themeable terminal with a brain.";
  meta.appendChild(tagline);
  identity.appendChild(meta);
  el.appendChild(identity);

  // Updates
  const upd = section("Updates");

  const channelRow = document.createElement("div");
  channelRow.style.cssText = "display:flex; gap:8px; align-items:center; margin-bottom:10px;";
  const channelLabel = document.createElement("span");
  channelLabel.textContent = "Update channel";
  channelLabel.style.cssText = "font-size:13px;";
  channelRow.appendChild(channelLabel);

  const unstableNote = document.createElement("div");
  unstableNote.textContent = "Unstable builds are preview releases and may be rough.";
  unstableNote.style.cssText =
    "font-size:12px; color:var(--fg-muted); margin-bottom:8px;";
  unstableNote.style.display = config!.updates.channel === "unstable" ? "block" : "none";

  const mkChannelBtn = (value: "stable" | "unstable", text: string) => {
    return button(text, async () => {
      if (config!.updates.channel === value) return;
      config!.updates.channel = value;
      await saveConfig();
      stableBtn.classList.toggle("primary", value === "stable");
      unstableBtn.classList.toggle("primary", value === "unstable");
      unstableNote.style.display = value === "unstable" ? "block" : "none";
      try {
        renderUpdateState(await forceCheckUpdate(value), null);
      } catch (e) {
        renderUpdateState(null, String(e));
      }
    });
  };
  const stableBtn = mkChannelBtn("stable", "Stable");
  const unstableBtn = mkChannelBtn("unstable", "Unstable");
  stableBtn.classList.toggle("primary", config!.updates.channel !== "unstable");
  unstableBtn.classList.toggle("primary", config!.updates.channel === "unstable");
  channelRow.appendChild(stableBtn);
  channelRow.appendChild(unstableBtn);
  upd.appendChild(channelRow);
  upd.appendChild(unstableNote);

  const status = document.createElement("div");
  status.style.cssText = "font-size: 13px; margin-bottom: 8px;";
  const release = document.createElement("div");
  release.style.cssText = "margin-bottom: 8px;";

  const renderUpdateState = (state: UpdateStatus | null, error: string | null): void => {
    release.innerHTML = "";
    if (error) {
      status.textContent = "Couldn't check (offline?)";
      status.style.color = "var(--fg-muted)";
      return;
    }
    if (!state) {
      status.textContent = "Click 'Check for updates' to check.";
      status.style.color = "var(--fg-muted)";
      return;
    }
    if (state.available) {
      status.innerHTML = "";
      const s = document.createElement("strong");
      s.textContent = `v${state.latest}`;
      status.appendChild(s);
      status.append(" is available.");
      status.style.color = "var(--fg)";

      const row2 = document.createElement("div");
      row2.style.cssText = "display:flex; gap:8px; align-items:center; margin-top:6px;";
      const progress = document.createElement("div");
      progress.style.cssText =
        "font-size:12px; color:var(--fg-muted); margin-top:6px; min-height:16px;";
      const install = button("Download & install", async () => {
        install.disabled = true;
        install.textContent = "Starting…";
        progress.textContent = "";
        try {
          await installUpdate(config!.updates.channel, (p: DownloadProgress) => {
            if (p.total && p.total > 0) {
              const pct = Math.min(100, Math.floor((p.downloaded / p.total) * 100));
              install.textContent = `Downloading ${pct}%`;
              progress.textContent = `${formatBytes(p.downloaded)} / ${formatBytes(p.total)}`;
            } else {
              install.textContent = "Downloading…";
              progress.textContent = formatBytes(p.downloaded);
            }
          });
          install.textContent = "Installed — relaunching";
        } catch (e) {
          install.disabled = false;
          install.textContent = "Download & install";
          progress.textContent = `Update failed: ${e}`;
          progress.style.color = "var(--danger)";
        }
      });
      install.classList.add("primary");
      row2.appendChild(install);
      const pageLink = button("Release page", async () => {
        try { await openUrl(state.release_url); } catch (_) {}
      });
      pageLink.classList.add("ghost");
      row2.appendChild(pageLink);
      release.appendChild(row2);
      release.appendChild(progress);
    } else {
      status.textContent = "You're up to date.";
      status.style.color = "var(--fg)";
    }
  };
  renderUpdateState(getCachedUpdate(), null);

  const checkBtn = button("Check for updates", async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = "Checking…";
    try {
      const fresh = await forceCheckUpdate(config!.updates.channel);
      renderUpdateState(fresh, null);
      render();
    } catch (e) {
      renderUpdateState(null, String(e));
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = "Check for updates";
    }
  });

  upd.appendChild(row("Updates", "Last checked when you opened this panel.", checkBtn));
  upd.appendChild(row(
    "Auto-update",
    "",
    toggle(config.updates.auto_check, (v) => {
      config!.updates.auto_check = v;
      void saveConfig();
    }),
  ));
  const row3 = document.createElement("div");
  row3.style.cssText = "padding: var(--density-pad) 0;";
  row3.appendChild(status);
  row3.appendChild(release);
  upd.appendChild(row3);

  const reinstallBtn = button("Reinstall latest stable", async () => {
    reinstallBtn.disabled = true;
    try {
      await reinstallStable();
    } catch (e) {
      reinstallBtn.disabled = false;
      const { showToast } = await import("./toast");
      showToast({ kind: "error", message: `Reinstall failed: ${e}` });
    }
  });
  reinstallBtn.classList.add("ghost");
  upd.appendChild(reinstallBtn);

  el.appendChild(upd);

  // Links
  const links = section("Links");
  const row4 = document.createElement("div");
  row4.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px;";
  const githubBtn = button("GitHub repository", () => openUrl("https://github.com/lucatescari/kimbo-terminal"));
  row4.appendChild(githubBtn);
  row4.appendChild(button("Changelog", () => openUrl("https://github.com/lucatescari/kimbo-terminal/blob/main/CHANGELOG.md")));
  row4.appendChild(button("Documentation", () => openUrl("https://github.com/lucatescari/kimbo-terminal/blob/main/README.md")));
  row4.appendChild(button("Report an issue", () => openUrl("https://github.com/lucatescari/kimbo-terminal/issues/new")));
  const licenseBtn = button("License (MIT)", () => openUrl("https://github.com/lucatescari/kimbo-terminal/blob/main/LICENSE"));
  licenseBtn.classList.add("ghost");
  row4.appendChild(licenseBtn);
  links.appendChild(row4);
  el.appendChild(links);
}

// ===========================================================================
// Helpers — layout + controls
// ===========================================================================

function header(title: string, subtitle: string): HTMLElement {
  const wrap = document.createElement("div");
  const h1 = document.createElement("h1");
  h1.textContent = title;
  wrap.appendChild(h1);
  const sub = document.createElement("p");
  sub.className = "subtitle";
  sub.innerHTML = subtitle || "&nbsp;";
  wrap.appendChild(sub);
  return wrap;
}

function section(title: string): HTMLElement {
  const sec = document.createElement("div");
  sec.className = "section";
  const head = document.createElement("div");
  head.className = "section-head";
  head.textContent = title;
  sec.appendChild(head);
  return sec;
}

function row(label: string, hint: string, control: HTMLElement): HTMLElement {
  const r = document.createElement("div");
  r.className = "row";
  const lc = document.createElement("div");
  lc.className = "lbl-col";
  const lbl = document.createElement("div");
  lbl.className = "label";
  lbl.textContent = label;
  lc.appendChild(lbl);
  if (hint) {
    const h = document.createElement("div");
    h.className = "hint";
    h.innerHTML = hint;
    lc.appendChild(h);
  }
  r.appendChild(lc);
  const cc = document.createElement("div");
  cc.className = "ctl-col";
  cc.appendChild(control);
  r.appendChild(cc);
  return r;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** Icon-only button used for compact controls (workspace reorder, etc.).
 *  Looks like a .btn.ghost but has no text, just an icon — the `title`
 *  attribute carries the accessible label. */
function iconBtn(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn ghost small icon-only";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.appendChild(icon(name, 14, 2));
  b.addEventListener("click", onClick);
  return b;
}

export function __createToggleForTests(
  initial: boolean,
  onChange: (v: boolean) => void,
  disabled = false,
): HTMLElement {
  return toggle(initial, onChange, disabled);
}

function toggle(initial: boolean, onChange: (v: boolean) => void, disabled = false): HTMLElement {
  const t = document.createElement("div");
  // We used to capture `value` in the click closure and call onChange(!value)
  // on every click — which meant the "current value" was frozen at element-
  // creation time, so a toggle without a surrounding re-render flipped once
  // and then got stuck (second click just fired onChange with the same value
  // again, and the `.on` CSS class never updated). Track the state inside
  // the element itself so every click reads and mutates the actual current
  // value, not the snapshot the factory was called with.
  let on = initial;
  const apply = () => {
    t.className = "toggle" + (on ? " on" : "") + (disabled ? " disabled" : "");
    t.setAttribute("aria-checked", String(on));
  };
  t.setAttribute("role", "switch");
  apply();
  t.addEventListener("click", () => {
    if (disabled) return;
    on = !on;
    apply();
    onChange(on);
  });
  return t;
}

/** Dropdown helper — the universal selector. Replaces native <select> and
 *  segmented controls so everything in settings uses the same visual
 *  language and updates its own "selected" label correctly. */
function select(value: string, opts: [string, string][], onChange: (v: string) => void): HTMLElement {
  return buildDropdown({
    value,
    options: opts.map(([v, l]) => ({ value: v, label: l })),
    onChange,
  });
}

/** Alias so existing call-sites keep compiling. Functionally identical to
 *  select() now — the old seg-ctl component is unused. */
function segCtl(value: string, opts: [string, string][], onChange: (v: string) => void): HTMLElement {
  return select(value, opts, onChange);
}

function numInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
  variant: "" | "narrow" | "num" = "narrow",
): HTMLElement {
  const i = document.createElement("input");
  i.type = "number";
  i.className = "input " + variant;
  i.value = String(value);
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.addEventListener("change", () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

function range(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  i.addEventListener("input", () => onChange(parseFloat(i.value)));
  return i;
}

function withComingSoon(control: HTMLElement, show: boolean): HTMLElement {
  if (!show) return control;
  const wrap = document.createElement("div");
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";
  control.style.pointerEvents = "none";
  control.style.opacity = "0.55";
  wrap.appendChild(control);
  const tag = document.createElement("span");
  tag.className = "cs-tag";
  tag.textContent = "Coming soon";
  wrap.appendChild(tag);
  return wrap;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

/** Normalize "#abc", "abc", "#aabbcc", "aabbcc" → "#aabbcc"; null if invalid. */
function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) {
    return "#" + s.split("").map((c) => c + c).join("");
  }
  if (/^[0-9a-f]{6}$/.test(s)) return "#" + s;
  return null;
}

/** Popover anchored under the custom-accent swatch with a native color picker
 *  and a hex text input. Apply writes prefs.accent and closes. */
function openCustomAccentPopover(anchor: HTMLElement, current: string): void {
  const existing = document.querySelector(".accent-popover");
  if (existing) { existing.remove(); return; }

  const initialHex = normalizeHex(current) ?? "#8aa9ff";

  const pop = document.createElement("div");
  pop.className = "accent-popover";
  pop.addEventListener("click", (e) => e.stopPropagation());
  pop.addEventListener("mousedown", (e) => e.stopPropagation());

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "accent-color-picker";
  colorInput.value = initialHex;

  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "input";
  hex.value = initialHex;
  hex.placeholder = "#rrggbb";
  hex.spellcheck = false;
  hex.style.minWidth = "100px";
  hex.style.width = "100px";

  colorInput.addEventListener("input", () => { hex.value = colorInput.value; });
  hex.addEventListener("input", () => {
    const n = normalizeHex(hex.value);
    if (n) colorInput.value = n;
  });

  const apply = (): void => {
    const n = normalizeHex(hex.value);
    if (!n) { hex.style.borderColor = "var(--danger)"; return; }
    setPref("accent", n);
    close();
    render();
  };

  hex.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  const applyBtn = button("Apply", apply);
  applyBtn.classList.add("primary", "small");

  pop.appendChild(colorInput);
  pop.appendChild(hex);
  pop.appendChild(applyBtn);

  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${r.left}px`;

  (overlayEl ?? modalHost()).appendChild(pop);

  // Dismiss on outside mousedown. Registered next tick so the click that
  // opened the popover doesn't immediately close it.
  let onDocDown: ((e: MouseEvent) => void) | null = null;
  const close = (): void => {
    pop.remove();
    if (onDocDown) document.removeEventListener("mousedown", onDocDown, true);
  };
  setTimeout(() => {
    onDocDown = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDocDown, true);
  }, 0);

  requestAnimationFrame(() => hex.focus());
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function saveConfig(): Promise<void> {
  if (!config) return;
  applyTerminalOptions({
    fontFamily: config.font.family,
    fontSize: config.font.size,
    lineHeight: config.font.line_height,
    cursorStyle: config.cursor.style as "block" | "underline" | "bar",
    cursorBlink: config.cursor.blink,
    scrollback: config.scrollback.lines,
  });
  fitAllPanes();
  try { await invoke("save_config", { config }); }
  catch (e) { console.error("save_config:", e); }
  applyRoot();
}
