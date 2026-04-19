import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { applyTerminalOptions, loadTheme } from "./theme";
import { fitAllPanes } from "./tabs";
import { kimboBus } from "./kimbo-bus";
import { setKimboInConsoleView } from "./kimbo";
import type { UnifiedTheme } from "./settings-types";
import { renderUnifiedThemeCard } from "./theme-card";
import { showThemeContextMenu } from "./theme-context-menu";
import {
  getCachedUpdate,
  forceCheckUpdate,
  hasPendingUpdate,
  downloadAndInstallUpdate,
  type UpdateInfo,
  type DownloadProgress,
} from "./updates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppConfig {
  general: { default_shell: string; default_layout: string };
  font: { family: string; size: number; line_height: number; ligatures: boolean };
  theme: { name: string };
  scrollback: { lines: number };
  cursor: { style: string; blink: boolean };
  keybindings: { bindings: Record<string, string> };
  workspace: { auto_detect: boolean; scan_dirs: string[] };
  updates: { auto_check: boolean };
}

type Category = "general" | "appearance" | "font" | "workspaces" | "kimbo" | "advanced" | "about";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "font", label: "Font" },
  { id: "workspaces", label: "Workspaces" },
  { id: "kimbo", label: "Kimbo" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let visible = false;
let config: AppConfig | null = null;
let unifiedThemes: UnifiedTheme[] = [];
let communityResolved = false;
let activeCategory: Category = "general";
let containerEl: HTMLElement;
let terminalAreaEl: HTMLElement;
let themesEventUnlisten: UnlistenFn | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initSettings(terminalArea: HTMLElement) {
  terminalAreaEl = terminalArea;

  // Create the settings container (hidden by default).
  containerEl = document.createElement("div");
  containerEl.id = "settings-view";
  containerEl.style.display = "none";
  containerEl.style.flex = "1";
  containerEl.style.minHeight = "0";
  containerEl.style.overflow = "hidden";
  terminalAreaEl.parentElement!.insertBefore(containerEl, terminalAreaEl.nextSibling);
}

export async function toggleSettings() {
  if (visible) {
    hideSettings();
  } else {
    await showSettings();
  }
}

export function hideSettings() {
  visible = false;
  containerEl.style.display = "none";
  terminalAreaEl.style.display = "flex";
  setKimboInConsoleView(true);
  if (themesEventUnlisten) {
    themesEventUnlisten();
    themesEventUnlisten = null;
  }
  communityResolved = false;
}

export function isSettingsVisible(): boolean {
  return visible;
}

// ---------------------------------------------------------------------------
// Show / Render
// ---------------------------------------------------------------------------

async function showSettings() {
  visible = true;
  kimboBus.emit({ type: "settings-open" });
  setKimboInConsoleView(false);
  terminalAreaEl.style.display = "none";
  containerEl.style.display = "flex";

  config = await invoke<AppConfig>("get_config");
  render();

  // Fetch unified themes: returns Builtin+Installed synchronously, then
  // emits 'themes://community-ready' when the Available group resolves.
  const active = config?.theme.name ?? "";
  unifiedThemes = await invoke<UnifiedTheme[]>("list_unified_themes", { activeSlug: active });
  if (activeCategory === "appearance") render();

  // Subscribe to the follow-up event. Unsubscribe on hide.
  if (themesEventUnlisten) {
    themesEventUnlisten();
    themesEventUnlisten = null;
  }
  themesEventUnlisten = await listen<UnifiedTheme[]>("themes://community-ready", (e) => {
    unifiedThemes = e.payload;
    communityResolved = true;
    if (visible && activeCategory === "appearance") render();
  });
}

function render() {
  if (!config) return;

  containerEl.innerHTML = "";
  containerEl.style.display = "flex";
  containerEl.style.flexDirection = "row";
  containerEl.style.background = "var(--bg)";
  containerEl.style.color = "var(--fg)";
  containerEl.style.fontFamily = "system-ui, -apple-system, sans-serif";
  containerEl.style.fontSize = "13px";

  // Sidebar.
  const sidebar = document.createElement("div");
  sidebar.style.cssText = "width: 180px; flex-shrink: 0; background: var(--tab-inactive-bg); border-right: 1px solid var(--border); padding: 16px 0; display: flex; flex-direction: column; gap: 2px;";

  for (const cat of CATEGORIES) {
    const btn = document.createElement("div");
    btn.style.cssText = `padding: 8px 20px; cursor: pointer; border-radius: 0; font-size: 13px; color: ${cat.id === activeCategory ? "var(--tab-active-fg)" : "var(--tab-inactive-fg)"}; background: ${cat.id === activeCategory ? "var(--surface)" : "transparent"}; display: flex; align-items: center; justify-content: space-between;`;

    const label = document.createElement("span");
    label.textContent = cat.label;
    btn.appendChild(label);

    if (cat.id === "about" && hasPendingUpdate()) {
      const dot = document.createElement("span");
      dot.style.cssText = "width: 8px; height: 8px; border-radius: 50%; background: var(--accent-red, #e06c75); display: inline-block;";
      dot.title = "Update available";
      btn.appendChild(dot);
    }

    btn.addEventListener("click", () => {
      activeCategory = cat.id;
      render();
    });
    sidebar.appendChild(btn);
  }

  // Close button at top of sidebar.
  const closeBtn = document.createElement("div");
  closeBtn.textContent = "\u00d7 Close";
  closeBtn.style.cssText = "padding: 8px 20px; cursor: pointer; font-size: 12px; color: var(--tab-inactive-fg); margin-top: auto;";
  closeBtn.addEventListener("click", hideSettings);
  sidebar.appendChild(closeBtn);

  // Content area.
  const content = document.createElement("div");
  content.style.cssText = "flex: 1; padding: 24px 32px; overflow-y: auto;";

  switch (activeCategory) {
    case "general": renderGeneral(content); break;
    case "appearance": renderAppearance(content); break;
    case "font": renderFont(content); break;
    case "workspaces": renderWorkspaces(content); break;
    case "kimbo": renderKimbo(content); break;
    case "advanced": renderAdvanced(content); break;
    case "about": renderAbout(content); break;
  }

  containerEl.appendChild(sidebar);
  containerEl.appendChild(content);
}

// ---------------------------------------------------------------------------
// Category renderers
// ---------------------------------------------------------------------------

function renderGeneral(el: HTMLElement) {
  if (!config) return;
  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">General</h2>`;

  el.appendChild(makeField("Default Shell", "text", config.general.default_shell, (v) => {
    config!.general.default_shell = v;
    saveConfig();
  }));
}

function renderAppearance(el: HTMLElement) {
  if (!config) return;
  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">Themes</h2>`;

  const active = config.theme.name;

  // Partition the unified list into Yours vs Available.
  const yours = unifiedThemes.filter((t) => t.source !== "Available");
  const available = unifiedThemes.filter((t) => t.source === "Available");

  // --- Yours ---
  el.appendChild(makeSubheader("Yours"));
  const yoursGrid = document.createElement("div");
  yoursGrid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-bottom: 24px;";
  for (const t of yours) {
    yoursGrid.appendChild(
      renderUnifiedThemeCard({ ...t, active: t.slug === active }, themeCardCallbacks()),
    );
  }
  el.appendChild(yoursGrid);

  // --- Available ---
  el.appendChild(makeSubheader("Available"));
  if (!communityResolved) {
    const loading = document.createElement("div");
    loading.textContent = "Loading community themes…";
    loading.style.cssText = "color: var(--tab-inactive-fg); font-size: 12px; padding: 8px 0;";
    el.appendChild(loading);
    return;
  }
  if (available.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "Community themes unavailable (offline?)";
    empty.style.cssText = "color: var(--tab-inactive-fg); font-size: 12px; padding: 8px 0;";
    el.appendChild(empty);
    return;
  }
  const availGrid = document.createElement("div");
  availGrid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px;";
  for (const t of available) {
    availGrid.appendChild(renderUnifiedThemeCard(t, themeCardCallbacks()));
  }
  el.appendChild(availGrid);
}

function makeSubheader(text: string): HTMLElement {
  const lbl = document.createElement("div");
  lbl.textContent = text;
  lbl.style.cssText = "font-size: 11px; text-transform: uppercase; color: var(--tab-inactive-fg); margin-bottom: 6px;";
  return lbl;
}

function themeCardCallbacks() {
  return {
    onActivate: async (slug: string) => {
      if (!config) return;
      config.theme.name = slug;
      await saveConfig();
      await loadTheme(slug);
      // Refresh the list so the `active` flag flips on the selected card.
      unifiedThemes = await invoke<UnifiedTheme[]>("list_unified_themes", { activeSlug: slug });
      if (activeCategory === "appearance") render();
    },
    onInstall: async (slug: string) => {
      try {
        await invoke("install_theme", { slug, activeSlug: config?.theme.name ?? "" });
        // Activate immediately so the click-to-install-and-use flow feels snappy.
        await themeCardCallbacks().onActivate(slug);
      } catch (err) {
        console.error("Install failed:", err);
      }
    },
    onOpenAuthor: async (username: string) => {
      try {
        await openUrl(`https://github.com/${username}`);
      } catch (e) {
        console.error("openUrl failed:", e);
      }
    },
    onContextMenu: (slug: string, x: number, y: number) => {
      const t = unifiedThemes.find((u) => u.slug === slug);
      if (!t) return;
      showThemeContextMenu(t, x, y, {
        onActivate: () => themeCardCallbacks().onActivate(slug),
        onInstall: () => themeCardCallbacks().onInstall(slug),
        onDelete: async () => {
          try {
            await invoke("delete_theme", { slug, activeSlug: config?.theme.name ?? "" });
          } catch (err) {
            console.error("Delete failed:", err);
          }
        },
        onOpenAuthor: () => themeCardCallbacks().onOpenAuthor(t.author),
      });
    },
  };
}

// Common cross-platform monospace fonts, ordered by popularity with developers.
const COMMON_MONOSPACE_FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "Hack",
  "Ubuntu Mono",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
];

function renderFont(el: HTMLElement) {
  if (!config) return;
  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">Font</h2>`;

  // Inject the current value if it's not in the common list — preserves any
  // custom font the user might have configured via config.toml.
  const current = config.font.family;
  const options = COMMON_MONOSPACE_FONTS.includes(current)
    ? COMMON_MONOSPACE_FONTS
    : [current, ...COMMON_MONOSPACE_FONTS];

  el.appendChild(makeSelect("Font Family", options, current, (v) => {
    config!.font.family = v;
    saveConfig();
  }));

  el.appendChild(makeField("Font Size", "number", String(config.font.size), (v) => {
    config!.font.size = parseFloat(v) || 14;
    saveConfig();
  }));

  el.appendChild(makeField("Line Height", "number", String(config.font.line_height), (v) => {
    config!.font.line_height = parseFloat(v) || 1.2;
    saveConfig();
  }));
}

function renderWorkspaces(el: HTMLElement) {
  if (!config) return;
  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">Workspaces</h2>`;

  el.appendChild(makeToggle("Auto-detect projects", config.workspace.auto_detect, (v) => {
    config!.workspace.auto_detect = v;
    saveConfig();
  }));

  const label = document.createElement("div");
  label.textContent = "Scan Directories";
  label.style.cssText = "font-size: 11px; text-transform: uppercase; color: var(--tab-inactive-fg); margin-bottom: 6px; margin-top: 16px;";
  el.appendChild(label);

  for (let i = 0; i < config.workspace.scan_dirs.length; i++) {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 8px; margin-bottom: 4px;";

    const input = document.createElement("input");
    input.type = "text";
    input.value = config.workspace.scan_dirs[i];
    input.style.cssText = "flex: 1; background: var(--surface); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 4px; font-size: 13px;";
    const idx = i;
    input.addEventListener("change", () => {
      config!.workspace.scan_dirs[idx] = input.value;
      saveConfig();
    });

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "\u00d7";
    removeBtn.style.cssText = "background: none; border: 1px solid var(--border); color: var(--tab-inactive-fg); padding: 4px 8px; border-radius: 4px; cursor: pointer;";
    removeBtn.addEventListener("click", () => {
      config!.workspace.scan_dirs.splice(idx, 1);
      saveConfig();
      render();
    });

    row.appendChild(input);
    row.appendChild(removeBtn);
    el.appendChild(row);
  }

  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add directory";
  addBtn.style.cssText = "background: none; border: 1px solid var(--border); color: var(--tab-inactive-fg); padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-top: 8px; font-size: 12px;";
  addBtn.addEventListener("click", () => {
    config!.workspace.scan_dirs.push("~/");
    saveConfig();
    render();
  });
  el.appendChild(addBtn);
}

async function renderKimbo(el: HTMLElement) {
  if (!config) return;
  // The kimbo field may be missing on older configs.
  const kimbo = (config as any).kimbo ?? { enabled: true, corner: "bottom_right", shell_integration: false };
  (config as any).kimbo = kimbo;

  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">Kimbo</h2>`;

  el.appendChild(makeToggle("Show Kimbo", kimbo.enabled, async (v) => {
    kimbo.enabled = v;
    await saveConfig();
    const mod = await import("./kimbo");
    mod.setKimboEnabled(v);
  }));

  el.appendChild(makeSelect("Corner", ["bottom_right", "bottom_left", "top_right", "top_left"], kimbo.corner, async (v) => {
    kimbo.corner = v;
    await saveConfig();
    const mod = await import("./kimbo");
    mod.setKimboCorner(v as any);
  }));

  // --- Shell integration ---
  const shellHeader = document.createElement("div");
  shellHeader.textContent = "Shell Integration";
  shellHeader.style.cssText = "font-size: 11px; text-transform: uppercase; color: var(--tab-inactive-fg); margin: 20px 0 6px;";
  el.appendChild(shellHeader);

  const desc = document.createElement("p");
  desc.textContent = "Lets Kimbo react to command success (happy) and failure (sad). Installs a shell snippet you'll source from your rc file.";
  desc.style.cssText = "font-size: 12px; color: var(--tab-inactive-fg); margin-bottom: 10px; max-width: 480px;";
  el.appendChild(desc);

  el.appendChild(makeToggle("Enable shell integration", kimbo.shell_integration, async (v) => {
    kimbo.shell_integration = v;
    await saveConfig();
    const mod = await import("./kimbo");
    mod.setKimboShellIntegration(v);
    if (v) await showShellInstructions(el);
    else el.querySelectorAll(".kimbo-shell-card").forEach((n) => n.remove());
  }));

  if (kimbo.shell_integration) await showShellInstructions(el);
}

async function showShellInstructions(el: HTMLElement) {
  if (!config) return;

  // Install snippets to ~/.config/kimbo/shell/
  let shellDir = "";
  try { shellDir = await invoke<string>("write_kimbo_shell_scripts"); }
  catch (e) {
    const err = document.createElement("div");
    err.textContent = `Failed to install shell scripts: ${e}`;
    err.style.cssText = "color: var(--accent-red); font-size: 12px; margin-top: 8px;";
    el.appendChild(err);
    return;
  }

  const shellPath = config.general.default_shell || "/bin/zsh";
  const snippetFile =
    shellPath.endsWith("fish") ? "kimbo-init.fish"
    : shellPath.endsWith("bash") ? "kimbo-init.bash"
    : "kimbo-init.zsh";
  const rcLine = `source ${shellDir}/${snippetFile}`;

  // Drop any existing instruction card (avoid duplicates on re-render).
  el.querySelectorAll(".kimbo-shell-card").forEach((n) => n.remove());

  const card = document.createElement("div");
  card.className = "kimbo-shell-card";
  card.style.cssText = "border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-top: 10px; max-width: 560px; background: var(--surface);";

  const label = document.createElement("div");
  label.textContent = `Add this line to your shell rc (detected: ${snippetFile}):`;
  label.style.cssText = "font-size: 12px; color: var(--tab-inactive-fg); margin-bottom: 6px;";
  card.appendChild(label);

  const code = document.createElement("code");
  code.textContent = rcLine;
  code.style.cssText = "display: block; padding: 8px 10px; background: var(--bg); border-radius: 4px; font-family: monospace; font-size: 12px; word-break: break-all;";
  card.appendChild(code);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy to clipboard";
  copyBtn.style.cssText = "margin-top: 8px; padding: 4px 10px; background: none; border: 1px solid var(--border); color: var(--fg); border-radius: 4px; cursor: pointer; font-size: 12px;";
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(rcLine); copyBtn.textContent = "Copied!"; }
    catch { copyBtn.textContent = "Copy failed"; }
    setTimeout(() => { copyBtn.textContent = "Copy to clipboard"; }, 1500);
  });
  card.appendChild(copyBtn);

  el.appendChild(card);
}

function renderAdvanced(el: HTMLElement) {
  if (!config) return;
  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">Advanced</h2>`;

  el.appendChild(makeField("Scrollback Lines", "number", String(config.scrollback.lines), (v) => {
    config!.scrollback.lines = parseInt(v) || 10000;
    saveConfig();
  }));

  el.appendChild(makeSelect("Cursor Style", ["block", "underline", "bar"], config.cursor.style, (v) => {
    config!.cursor.style = v;
    saveConfig();
  }));

  el.appendChild(makeToggle("Cursor Blink", config.cursor.blink, (v) => {
    config!.cursor.blink = v;
    saveConfig();
  }));
}

async function renderAbout(el: HTMLElement) {
  if (!config) return;
  el.innerHTML = `<h2 style="margin-bottom: 20px; font-size: 18px;">About</h2>`;

  const info = getCachedUpdate();
  const currentVersion = info?.current ?? "unknown";

  // --- App identity block ---
  const ident = document.createElement("div");
  ident.style.cssText = "margin-bottom: 24px;";

  const identName = document.createElement("div");
  identName.style.cssText = "font-size: 16px; font-weight: 600;";
  identName.textContent = "Kimbo";
  ident.appendChild(identName);

  const identVersion = document.createElement("div");
  identVersion.style.cssText = "font-size: 12px; color: var(--tab-inactive-fg); margin-top: 2px;";
  identVersion.textContent = `Version ${currentVersion}`;
  ident.appendChild(identVersion);

  el.appendChild(ident);

  // --- Updates block ---
  el.appendChild(makeSubheader("Updates"));
  const updatesBox = document.createElement("div");
  updatesBox.style.cssText = "margin-bottom: 16px;";
  el.appendChild(updatesBox);

  const status = document.createElement("div");
  status.style.cssText = "font-size: 13px; margin-bottom: 8px;";
  updatesBox.appendChild(status);

  const releaseBlock = document.createElement("div");
  releaseBlock.style.cssText = "margin-bottom: 8px;";
  updatesBox.appendChild(releaseBlock);

  const renderUpdateState = (state: UpdateInfo | null, error: string | null) => {
    releaseBlock.innerHTML = "";
    if (error) {
      status.textContent = "Couldn't check (offline?)";
      status.style.color = "var(--tab-inactive-fg)";
      return;
    }
    if (!state) {
      status.textContent = "Click 'Check for updates' to check.";
      status.style.color = "var(--tab-inactive-fg)";
      return;
    }
    if (state.is_newer) {
      const date = state.published_at && state.published_at.length >= 10
        ? state.published_at.slice(0, 10)
        : "";
      status.textContent = "";
      const versionStrong = document.createElement("strong");
      versionStrong.textContent = `v${state.latest}`;
      status.appendChild(versionStrong);
      status.append(` is available${date ? ` (released ${date})` : ""}.`);
      status.style.color = "var(--fg)";

      // Row: primary install action + secondary release-page link.
      const row = document.createElement("div");
      row.style.cssText = "display: flex; gap: 8px; align-items: center; margin-top: 4px;";

      const installBtn = document.createElement("button");
      installBtn.textContent = "Download & install";
      installBtn.style.cssText = "padding: 6px 12px; background: var(--accent-blue); border: 1px solid var(--accent-blue); color: var(--bg); border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;";

      const progressLine = document.createElement("div");
      progressLine.style.cssText = "font-size: 12px; color: var(--tab-inactive-fg); margin-top: 6px; min-height: 16px;";

      installBtn.addEventListener("click", async () => {
        installBtn.disabled = true;
        installBtn.textContent = "Starting…";
        progressLine.textContent = "";
        try {
          await downloadAndInstallUpdate((p: DownloadProgress) => {
            if (p.total && p.total > 0) {
              const pct = Math.min(100, Math.floor((p.downloaded / p.total) * 100));
              installBtn.textContent = `Downloading ${pct}%`;
              progressLine.textContent = `${formatBytes(p.downloaded)} / ${formatBytes(p.total)}`;
            } else {
              installBtn.textContent = "Downloading…";
              progressLine.textContent = formatBytes(p.downloaded);
            }
          });
          // If we reach this line the relaunch didn't happen — show a hint.
          installBtn.textContent = "Installed — relaunching";
        } catch (e) {
          console.error("downloadAndInstall failed:", e);
          installBtn.disabled = false;
          installBtn.textContent = "Download & install";
          progressLine.textContent = `Update failed: ${String(e)}`;
          progressLine.style.color = "var(--accent-red)";
        }
      });
      row.appendChild(installBtn);

      const pageLink = document.createElement("a");
      pageLink.textContent = "Release page";
      pageLink.href = "#";
      pageLink.style.cssText = "font-size: 12px; color: var(--tab-inactive-fg); text-decoration: none; margin-left: 4px;";
      pageLink.addEventListener("click", async (ev) => {
        ev.preventDefault();
        try { await openUrl(state.release_url); }
        catch (e) { console.error("openUrl failed:", e); }
      });
      row.appendChild(pageLink);

      releaseBlock.appendChild(row);
      releaseBlock.appendChild(progressLine);
    } else {
      status.textContent = "You're up to date.";
      status.style.color = "var(--fg)";
    }
  };

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  renderUpdateState(info, null);

  const checkBtn = document.createElement("button");
  checkBtn.textContent = "Check for updates";
  checkBtn.style.cssText = "padding: 6px 12px; background: var(--surface); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; cursor: pointer; font-size: 12px; margin-bottom: 16px;";
  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = "Checking…";
    try {
      const fresh = await forceCheckUpdate();
      renderUpdateState(fresh, null);
      // Re-render the sidebar so the dot appears/disappears.
      render();
    } catch (e) {
      console.warn("forceCheckUpdate failed:", e);
      renderUpdateState(null, String(e));
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = "Check for updates";
    }
  });
  el.appendChild(checkBtn);

  el.appendChild(makeToggle("Check for updates automatically", config.updates.auto_check, (v) => {
    config!.updates.auto_check = v;
    saveConfig();
  }));

  // --- Links block ---
  el.appendChild(makeSubheader("Links"));
  const links = document.createElement("div");
  links.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;";

  const repoLink = document.createElement("a");
  repoLink.textContent = "GitHub repository";
  repoLink.href = "#";
  repoLink.style.cssText = "color: var(--accent-blue, var(--fg)); text-decoration: underline; cursor: pointer; font-size: 13px;";
  repoLink.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try { await openUrl("https://github.com/lucatescari/kimbo-terminal"); }
    catch (e) { console.error("openUrl failed:", e); }
  });
  links.appendChild(repoLink);

  const licenseLink = document.createElement("a");
  licenseLink.textContent = "License (MIT)";
  licenseLink.href = "#";
  licenseLink.style.cssText = "color: var(--accent-blue, var(--fg)); text-decoration: underline; cursor: pointer; font-size: 13px;";
  licenseLink.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try { await openUrl("https://github.com/lucatescari/kimbo-terminal/blob/main/LICENSE"); }
    catch (e) { console.error("openUrl failed:", e); }
  });
  links.appendChild(licenseLink);

  el.appendChild(links);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(label: string, type: string, value: string, onChange: (v: string) => void): HTMLElement {
  const group = document.createElement("div");
  group.style.cssText = "margin-bottom: 16px;";

  const lbl = document.createElement("div");
  lbl.textContent = label;
  lbl.style.cssText = "font-size: 11px; text-transform: uppercase; color: var(--tab-inactive-fg); margin-bottom: 6px;";

  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.style.cssText = "width: 100%; max-width: 300px; background: var(--surface); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 4px; font-size: 13px;";
  input.addEventListener("change", () => onChange(input.value));

  group.appendChild(lbl);
  group.appendChild(input);
  return group;
}

function makeSelect(label: string, options: string[], value: string, onChange: (v: string) => void): HTMLElement {
  const group = document.createElement("div");
  group.style.cssText = "margin-bottom: 16px;";

  const lbl = document.createElement("div");
  lbl.textContent = label;
  lbl.style.cssText = "font-size: 11px; text-transform: uppercase; color: var(--tab-inactive-fg); margin-bottom: 6px;";

  const select = document.createElement("select");
  select.style.cssText = "background: var(--surface); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 4px; font-size: 13px;";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => onChange(select.value));

  group.appendChild(lbl);
  group.appendChild(select);
  return group;
}

function makeToggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const group = document.createElement("div");
  group.style.cssText = "margin-bottom: 16px; display: flex; align-items: center; gap: 10px;";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = value;
  checkbox.style.cssText = "width: 16px; height: 16px; cursor: pointer;";
  checkbox.addEventListener("change", () => onChange(checkbox.checked));

  const lbl = document.createElement("span");
  lbl.textContent = label;
  lbl.style.cssText = "font-size: 13px;";

  group.appendChild(checkbox);
  group.appendChild(lbl);
  return group;
}

async function saveConfig() {
  if (!config) return;
  applyTerminalOptions({
    fontFamily: config.font.family,
    fontSize: config.font.size,
    lineHeight: config.font.line_height,
    cursorStyle: config.cursor.style as "block" | "underline" | "bar",
    cursorBlink: config.cursor.blink,
    scrollback: config.scrollback.lines,
  });
  // Re-fit panes since font metrics may have changed character size.
  fitAllPanes();
  try {
    await invoke("save_config", { config });
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}
