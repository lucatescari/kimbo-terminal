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
import { getPrefs, setPref, applyRoot, type Density, type TabStyle } from "./ui-prefs";
import { isMacOS } from "./platform";
import {
  getCachedUpdate,
  forceCheckUpdate,
  hasPendingUpdate,
  downloadAndInstallUpdate,
  type UpdateInfo,
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
  updates: { auto_check: boolean };
  welcome: { show_on_startup: boolean };
}

export type SettingsCategory =
  | "general"
  | "appearance"
  | "font"
  | "workspaces"
  | "keybinds"
  | "kimbo"
  | "advanced"
  | "about";

const NAV: { id: SettingsCategory; label: string; icon: IconName }[] = [
  { id: "general",    label: "General",    icon: "sliders" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "font",       label: "Font",       icon: "type" },
  { id: "workspaces", label: "Workspaces", icon: "layers" },
  { id: "keybinds",   label: "Keybinds",   icon: "keyboard" },
  { id: "kimbo",      label: "Kimbo",      icon: "smile" },
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
let overlayEl: HTMLElement | null = null;
let themesEventUnlisten: UnlistenFn | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

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
  setKimboInConsoleView(true);
  if (themesEventUnlisten) { themesEventUnlisten(); themesEventUnlisten = null; }
  if (escapeHandler) { document.removeEventListener("keydown", escapeHandler, true); escapeHandler = null; }
  communityResolved = false;
  communityCatalogSize = 0;
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
        if (visible && activeCategory === "appearance") render();
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
      if (activeCategory === "appearance") render();
    }
  } catch (e) { console.warn("list_unified_themes:", e); }
}

function render(): void {
  if (!overlayEl || !config) return;
  overlayEl.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "settings";
  panel.addEventListener("click", (e) => e.stopPropagation());

  // Sidebar
  const side = document.createElement("div");
  side.className = "side";

  const head = document.createElement("div");
  head.className = "side-head";
  head.textContent = "Settings";
  side.appendChild(head);

  for (const n of NAV) {
    const btn = document.createElement("button");
    btn.className = "nav" + (activeCategory === n.id ? " active" : "");
    btn.type = "button";
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
      activeCategory = n.id;
      render();
    });
    side.appendChild(btn);
  }

  const foot = document.createElement("div");
  foot.className = "side-foot";
  const close = document.createElement("button");
  close.className = "close-btn";
  close.type = "button";
  close.textContent = "Close · esc";
  close.addEventListener("click", hideSettings);
  foot.appendChild(close);
  side.appendChild(foot);

  // Main
  const main = document.createElement("div");
  main.className = "main";

  switch (activeCategory) {
    case "general":    renderGeneral(main); break;
    case "appearance": renderAppearance(main); break;
    case "font":       renderFont(main); break;
    case "workspaces": renderWorkspaces(main); break;
    case "keybinds":   renderKeybinds(main); break;
    case "kimbo":      void renderKimbo(main); break;
    case "advanced":   renderAdvanced(main); break;
    case "about":      void renderAbout(main); break;
  }

  panel.appendChild(side);
  panel.appendChild(main);
  overlayEl.appendChild(panel);
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
    "Window chrome",
    "How the window frame is drawn.",
    withComingSoon(segCtl(prefs.windowChrome, [
      ["native", "Native"],
      ["flat", "Flat"],
      ["hidden", "Hidden"],
    ], (v) => setPref("windowChrome", v as typeof prefs.windowChrome)), true),
  ));
  windowSec.appendChild(row(
    "Open new windows at",
    "Position on screen for new windows.",
    withComingSoon(select(prefs.newWindowPosition, [
      ["cursor", "Under cursor"],
      ["center", "Screen center"],
      ["last", "Last position"],
    ], (v) => setPref("newWindowPosition", v as typeof prefs.newWindowPosition)), true),
  ));
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
  const yours = unifiedThemes.filter((t) => t.source !== "Available");
  const available = unifiedThemes.filter((t) => t.source === "Available");

  if (yours.length > 0) {
    const grid = document.createElement("div");
    grid.className = "theme-grid";
    for (const t of yours) grid.appendChild(themeCard(t, t.slug === active));
    themeSec.appendChild(grid);
  } else {
    const empty = document.createElement("div");
    empty.style.cssText = "color: var(--fg-muted); font-size: 12px; padding: 6px 0;";
    empty.textContent = "Loading themes…";
    themeSec.appendChild(empty);
  }

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 16px;";
  btnRow.appendChild(button("Browse gallery", () => {
    const gallery = document.querySelector(".settings .main .gallery");
    if (gallery) gallery.scrollIntoView({ behavior: "smooth" });
  }));
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
      const slug = await invoke<string>("install_theme_from_file", {
        filePath: selected,
        activeSlug: config?.theme.name ?? null,
      });
      // The rust command spawns an emit of `themes://community-ready` which
      // the gallery listener already picks up; nothing else to do here.
      console.log(`[kimbo.theme] imported '${slug}' from ${selected}`);
    } catch (e) {
      alert(`Could not import theme:\n\n${e instanceof Error ? e.message : String(e)}`);
    }
  });
  importBtn.classList.add("ghost");
  btnRow.appendChild(importBtn);
  themeSec.appendChild(btnRow);
  el.appendChild(themeSec);

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

  // Community gallery
  const gallery = section("Community gallery");
  gallery.classList.add("gallery");
  const galleryMsg = (text: string): HTMLElement => {
    const d = document.createElement("div");
    d.textContent = text;
    d.style.cssText = "color: var(--fg-muted); font-size: 12px; padding: 6px 0;";
    return d;
  };
  if (!communityResolved && communityCatalogSize === 0) {
    // Fetch in progress OR fetch failed (no cache, no network response yet).
    gallery.appendChild(galleryMsg("Loading community themes…"));
  } else if (!communityResolved) {
    // Resolved=false but we have a catalog size from a prior successful
    // fetch — shouldn't happen in practice, same UX as loading.
    gallery.appendChild(galleryMsg("Loading community themes…"));
  } else if (communityCatalogSize === 0) {
    // Actually offline or catalog empty.
    gallery.appendChild(galleryMsg("Community themes unavailable (offline?)"));
  } else if (available.length === 0) {
    // Fetch succeeded and all themes in catalog are already installed.
    {
      const n = communityCatalogSize;
      const noun = n === 1 ? "theme" : "themes";
      const verb = n === 1 ? "is" : "are";
      gallery.appendChild(galleryMsg(
        `All ${n} community ${noun} ${verb} installed. Uninstall any theme above (hover → ×) to see it in the gallery again.`,
      ));
    }
  } else {
    const grid = document.createElement("div");
    grid.className = "theme-grid";
    for (const t of available) grid.appendChild(themeCard(t, false));
    gallery.appendChild(grid);
  }
  el.appendChild(gallery);
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
  const prefs = getPrefs();
  rendering.appendChild(row("Font smoothing", "",
    withComingSoon(segCtl(prefs.fontSmoothing, [
      ["none", "None"],
      ["grayscale", "Grayscale"],
      ["subpixel", "Subpixel"],
    ], (v) => setPref("fontSmoothing", v as typeof prefs.fontSmoothing)), true),
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

const BINDS_DEFAULT: { cat: string; label: string; keys: string[] }[] = [
  { cat: "tabs",  label: "New tab",              keys: ["⌘", "T"] },
  { cat: "tabs",  label: "Close tab",            keys: ["⌘", "⇧", "W"] },
  { cat: "tabs",  label: "Next tab",             keys: ["⌘", "]"] },
  { cat: "tabs",  label: "Previous tab",         keys: ["⌘", "["] },
  { cat: "panes", label: "Split right",          keys: ["⌘", "D"] },
  { cat: "panes", label: "Split down",           keys: ["⌘", "⇧", "D"] },
  { cat: "panes", label: "Close pane",           keys: ["⌘", "W"] },
  { cat: "panes", label: "Focus pane up",        keys: ["⌘", "↑"] },
  { cat: "panes", label: "Focus pane down",      keys: ["⌘", "↓"] },
  { cat: "panes", label: "Focus pane left",      keys: ["⌘", "←"] },
  { cat: "panes", label: "Focus pane right",     keys: ["⌘", "→"] },
  { cat: "nav",   label: "Command palette",      keys: ["⌘", "K"] },
  { cat: "nav",   label: "Settings",             keys: ["⌘", ","] },
  { cat: "edit",  label: "Find in terminal",     keys: ["⌘", "F"] },
  { cat: "app",   label: "Quit",                 keys: ["⌘", "Q"] },
];

function renderKeybinds(el: HTMLElement): void {
  el.appendChild(header("Keybinds", "Keyboard shortcuts for Kimbo. Rebinding is coming soon."));

  const sec = section("All shortcuts");
  const table = document.createElement("div");
  table.className = "keytable";
  for (const b of BINDS_DEFAULT) {
    const r = document.createElement("div");
    r.className = "krow";
    const left = document.createElement("div");
    const cat = document.createElement("span");
    cat.className = "cat";
    cat.textContent = b.cat;
    left.appendChild(cat);
    left.appendChild(document.createTextNode(b.label));
    r.appendChild(left);

    const chip = document.createElement("div");
    chip.className = "kbd-chip";
    for (const k of b.keys) {
      const s = document.createElement("span");
      s.textContent = k;
      chip.appendChild(s);
    }
    r.appendChild(chip);
    table.appendChild(r);
  }
  sec.appendChild(table);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 12px;";
  const reset = button("Reset to defaults", () => alert("Coming soon."));
  reset.classList.add("ghost", "coming-soon");
  btnRow.appendChild(reset);
  const exp = button("Export keymap", () => {
    const data = BINDS_DEFAULT.map((b) => `${b.label}\t${b.keys.join("+")}`).join("\n");
    void navigator.clipboard.writeText(data);
    alert("Keymap copied to clipboard.");
  });
  exp.classList.add("ghost");
  btnRow.appendChild(exp);
  sec.appendChild(btnRow);

  el.appendChild(sec);
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
// Advanced
// ===========================================================================

function renderAdvanced(el: HTMLElement): void {
  if (!config) return;
  el.appendChild(header("Advanced", "Experimental flags and low-level behavior. Handle with care."));

  const prefs = getPrefs();

  const perf = section("Performance");
  perf.appendChild(row(
    "GPU rendering",
    "Uses Metal/WebGPU for the terminal renderer. Currently always on.",
    withComingSoon(toggle(prefs.gpuRendering, (v) => setPref("gpuRendering", v), true), true),
  ));
  perf.appendChild(row(
    "Scrollback lines",
    "How many lines Kimbo keeps in memory per pane.",
    numInput(config.scrollback.lines, 1000, 200_000, 1000, (v) => {
      config!.scrollback.lines = v;
      void saveConfig();
    }, "num"),
  ));
  perf.appendChild(row(
    "Flush interval (ms)",
    "Lower = smoother streaming, higher = better throughput.",
    withComingSoon(numInput(prefs.flushIntervalMs, 4, 64, 1, (v) => setPref("flushIntervalMs", v), "narrow"), true),
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
      try { await openUrl(`file://${await invoke<string>("get_config_path").catch(() => "/tmp/kimbo-config.toml")}`); }
      catch { alert("Open your config at ~/.config/kimbo/config.toml"); }
    }),
  ));
  const resetBtn = button("Reset…", () => {
    if (!confirm("Reset all settings to defaults? This cannot be undone.")) return;
    alert("Coming soon — for now, remove ~/.config/kimbo/config.toml manually.");
  });
  resetBtn.classList.add("danger", "coming-soon");
  cfg.appendChild(row(
    "Reset all settings",
    "Clears your preferences and restarts with defaults.",
    resetBtn,
  ));
  el.appendChild(cfg);

  const priv = section("Privacy");
  priv.appendChild(row(
    "Send anonymous telemetry",
    "Crash reports and anonymized usage. No command content. Kimbo does not collect telemetry today.",
    withComingSoon(toggle(prefs.telemetry, (v) => setPref("telemetry", v), true), true),
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
  const status = document.createElement("div");
  status.style.cssText = "font-size: 13px; margin-bottom: 8px;";
  const release = document.createElement("div");
  release.style.cssText = "margin-bottom: 8px;";

  const renderUpdateState = (state: UpdateInfo | null, error: string | null): void => {
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
    if (state.is_newer) {
      const date = state.published_at?.slice(0, 10) ?? "";
      status.innerHTML = "";
      const s = document.createElement("strong");
      s.textContent = `v${state.latest}`;
      status.appendChild(s);
      status.append(` is available${date ? ` (released ${date})` : ""}.`);
      status.style.color = "var(--fg)";

      const row2 = document.createElement("div");
      row2.style.cssText = "display: flex; gap: 8px; align-items: center; margin-top: 6px;";
      const install = button("Download & install", async () => {
        install.disabled = true;
        install.innerHTML = "";
        install.appendChild(icon("download", 12));
        install.appendChild(document.createTextNode(" Starting…"));
        progress.textContent = "";
        try {
          await downloadAndInstallUpdate((p: DownloadProgress) => {
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
      const progress = document.createElement("div");
      progress.style.cssText = "font-size: 12px; color: var(--fg-muted); margin-top: 6px; min-height: 16px;";
      release.appendChild(row2);
      release.appendChild(progress);
    } else {
      status.textContent = "You're up to date.";
      status.style.color = "var(--fg)";
    }
  };
  renderUpdateState(info, null);

  const checkBtn = button("Check for updates", async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = "Checking…";
    try {
      const fresh = await forceCheckUpdate();
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
  const prefs = getPrefs();
  upd.appendChild(row(
    "Release channel",
    "Pick the update stream Kimbo subscribes to.",
    withComingSoon(segCtl(prefs.releaseChannel, [
      ["stable", "Stable"],
      ["beta", "Beta"],
      ["nightly", "Nightly"],
    ], (v) => setPref("releaseChannel", v as typeof prefs.releaseChannel)), true),
  ));
  const row3 = document.createElement("div");
  row3.style.cssText = "padding: var(--density-pad) 0;";
  row3.appendChild(status);
  row3.appendChild(release);
  upd.appendChild(row3);
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
