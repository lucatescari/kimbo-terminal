// Command palette (⌘K). Modal overlay with fuzzy search over a registered
// command list. Commands dispatch app actions directly — no shell execution.
//
// Keys: ⏎ run, esc close (or leave projects mode), ↑/↓ navigate, ⌘K toggle.
//
// The palette has two modes — the "commands" list is the default; when the
// user picks "Open project…" we swap the same modal into a "projects" mode
// that calls the rust list_projects command and lets them fuzzy-search
// discovered Git repos. Escape from projects returns to commands (so it's
// easy to back out); escape from commands closes. This replaces the old
// standalone ⌘O launcher — merging keeps one overlay, one input, one set
// of keybindings, and one focus trap.

import { invoke } from "@tauri-apps/api/core";
import { icon, type IconName } from "./icons";
import {
  createTab,
  closeTab,
  nextTab,
  prevTab,
  getActiveTab,
  splitActive,
  closeActiveOrTab,
  getActiveSession,
} from "./tabs";
import { toggleSettings, openSettingsToCategory } from "./settings";
import { toggleFindBar } from "./find-bar";
import { kimboBus } from "./kimbo-bus";

export interface Command {
  id: string;
  label: string;
  icon: IconName;
  /** Text shown on the right (shortcut or category hint). */
  hint: string;
  /** Keywords boosted during search. */
  keywords?: string[];
  /** If true, the palette stays open when this command runs (the command is
   *  responsible for the next UI state — used by project-mode entry). */
  keepOpen?: boolean;
  run: () => void | Promise<void>;
}

interface ProjectInfo {
  name: string;
  path: string;
  project_type: string;
}

type Mode = "commands" | "projects";

const commands: Command[] = [];

export function registerCommand(cmd: Command): void {
  commands.push(cmd);
}

export function listCommands(): ReadonlyArray<Command> {
  return commands;
}

export function initCommandPalette(): void {
  if (commands.length > 0) return;

  registerCommand({
    id: "new-tab",
    label: "New tab",
    icon: "plus",
    hint: "⌘T",
    run: () => { void createTab(); },
  });
  registerCommand({
    id: "split-right",
    label: "Split pane right",
    icon: "split",
    hint: "⌘D",
    keywords: ["vertical"],
    run: () => { void splitActive("vertical"); },
  });
  registerCommand({
    id: "split-down",
    label: "Split pane down",
    icon: "split",
    hint: "⌘⇧D",
    keywords: ["horizontal"],
    run: () => { void splitActive("horizontal"); },
  });
  registerCommand({
    id: "close-pane",
    label: "Close pane",
    icon: "close",
    hint: "⌘W",
    run: () => closeActiveOrTab(),
  });
  registerCommand({
    id: "close-tab",
    label: "Close tab",
    icon: "close",
    hint: "⌘⇧W",
    run: () => {
      const t = getActiveTab();
      if (t) closeTab(t.id);
    },
  });
  registerCommand({
    id: "next-tab",
    label: "Next tab",
    icon: "chevron-d",
    hint: "⌘]",
    run: () => nextTab(),
  });
  registerCommand({
    id: "prev-tab",
    label: "Previous tab",
    icon: "chevron-d",
    hint: "⌘[",
    run: () => prevTab(),
  });
  registerCommand({
    id: "settings",
    label: "Open settings",
    icon: "settings",
    hint: "⌘,",
    run: () => { void toggleSettings(); },
  });
  registerCommand({
    id: "theme",
    label: "Change theme…",
    icon: "palette",
    hint: "settings",
    keywords: ["appearance"],
    run: () => { void openSettingsToCategory("appearance"); },
  });
  registerCommand({
    id: "font",
    label: "Change font…",
    icon: "type",
    hint: "settings",
    run: () => { void openSettingsToCategory("font"); },
  });
  registerCommand({
    id: "keybinds",
    label: "Edit keybinds…",
    icon: "keyboard",
    hint: "settings",
    run: () => { void openSettingsToCategory("keybinds"); },
  });
  registerCommand({
    id: "workspace",
    label: "Open project…",
    icon: "folder",
    hint: "projects",
    keywords: ["workspace", "project", "launcher", "directory", "repo", "git"],
    keepOpen: true,
    run: () => { void enterProjectsMode(); },
  });
  registerCommand({
    id: "clear",
    label: "Clear terminal buffer",
    icon: "terminal",
    hint: "⌘L",
    run: () => {
      const s = getActiveSession();
      s?.term.clear();
    },
  });
  registerCommand({
    id: "find",
    label: "Find in terminal",
    icon: "search",
    hint: "⌘F",
    run: () => toggleFindBar(),
  });
  registerCommand({
    id: "copy",
    label: "Copy selection",
    icon: "copy",
    hint: "⌘C",
    run: () => {
      const s = getActiveSession();
      const sel = s?.term.getSelection();
      if (sel) { void navigator.clipboard.writeText(sel); }
    },
  });
  registerCommand({
    id: "quit",
    label: "Quit Kimbo",
    icon: "close",
    hint: "⌘Q",
    run: () => { void invoke("quit_app"); },
  });
}

// ---------- Rendering ----------

let overlay: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let modeBadge: HTMLButtonElement | null = null;
let selected = 0;
let mode: Mode = "commands";
let filteredCommands: Command[] = [];
let filteredProjects: ProjectInfo[] = [];
// Projects are fetched lazily on first entry to projects mode and cached
// for the lifetime of the palette's open-close cycle (cleared on close so
// a new session picks up newly-cloned repos).
let projectsCache: ProjectInfo[] = [];
let projectsLoaded = false;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

// Light-grey text shown on the "Open project…" command and in the projects
// mode's placeholder, centralised so renames stay consistent.
const PROJECTS_PLACEHOLDER = "Search a project…";
const COMMANDS_PLACEHOLDER = "Type a command or search…";

export function isCommandPaletteVisible(): boolean {
  return overlay !== null;
}

export function toggleCommandPalette(): void {
  if (overlay) hideCommandPalette();
  else showCommandPalette();
}

export function hideCommandPalette(): void {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  inputEl = null;
  listEl = null;
  countEl = null;
  modeBadge = null;
  filteredCommands = [];
  filteredProjects = [];
  projectsCache = [];
  projectsLoaded = false;
  mode = "commands";
  selected = 0;
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler, true);
    keyHandler = null;
  }
}

export function showCommandPalette(): void {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.className = "palette-backdrop";
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) hideCommandPalette();
  });

  const panel = document.createElement("div");
  panel.className = "palette";
  panel.addEventListener("mousedown", (e) => e.stopPropagation());
  overlay.appendChild(panel);

  // Input row gets a mode badge on the left when we switch to projects,
  // so the user has a visual cue they're in a sub-mode and can click/×
  // their way back to commands.
  const inputRow = document.createElement("div");
  inputRow.className = "p-input-row";
  panel.appendChild(inputRow);

  modeBadge = document.createElement("button");
  modeBadge.type = "button";
  modeBadge.className = "p-mode-badge hidden";
  modeBadge.textContent = "Projects";
  modeBadge.title = "Back to commands (esc)";
  modeBadge.addEventListener("click", () => enterCommandsMode());
  inputRow.appendChild(modeBadge);

  inputEl = document.createElement("input");
  inputEl.className = "p-input";
  inputEl.placeholder = COMMANDS_PLACEHOLDER;
  inputEl.autocomplete = "off";
  inputEl.spellcheck = false;
  inputEl.addEventListener("input", () => {
    selected = 0;
    renderList();
  });
  inputRow.appendChild(inputEl);

  listEl = document.createElement("div");
  listEl.className = "p-list";
  panel.appendChild(listEl);

  panel.appendChild(buildFooter());

  (document.getElementById("modal-root") ?? document.body).appendChild(overlay);

  keyHandler = (e: KeyboardEvent) => {
    if (!overlay) return;
    if (e.key === "Escape") {
      e.preventDefault();
      // In projects mode, esc pops back to commands; in commands mode it
      // closes the palette entirely. Matches how a "back" button works.
      if (mode === "projects") enterCommandsMode();
      else hideCommandPalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const len = currentListLength();
      if (len === 0) return;
      selected = Math.min(selected + 1, len - 1);
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    }
  };
  document.addEventListener("keydown", keyHandler, true);

  renderList();
  requestAnimationFrame(() => inputEl?.focus());
}

async function enterProjectsMode(): Promise<void> {
  if (!inputEl || !modeBadge) return;
  mode = "projects";
  // Kimbo's mascot listens for launcher-open to do the "excited" pose — the
  // old standalone launcher fired this on open, we keep the signal intact.
  kimboBus.emit({ type: "launcher-open" });
  inputEl.value = "";
  inputEl.placeholder = PROJECTS_PLACEHOLDER;
  modeBadge.classList.remove("hidden");
  selected = 0;

  // Show a momentary "Loading projects…" state so the palette doesn't
  // flash empty while list_projects walks the filesystem.
  renderList();

  if (!projectsLoaded) {
    try {
      projectsCache = await invoke<ProjectInfo[]>("list_projects");
    } catch {
      projectsCache = [];
    }
    projectsLoaded = true;
  }
  // Mode may have flipped back during await (user pressed esc); only
  // re-render if we're still in projects mode.
  if (mode === "projects") renderList();
}

function enterCommandsMode(): void {
  if (!inputEl || !modeBadge) return;
  mode = "commands";
  inputEl.value = "";
  inputEl.placeholder = COMMANDS_PLACEHOLDER;
  modeBadge.classList.add("hidden");
  selected = 0;
  inputEl.focus();
  renderList();
}

function currentListLength(): number {
  return mode === "commands" ? filteredCommands.length : filteredProjects.length;
}

function runSelected(): void {
  if (mode === "commands") {
    const cmd = filteredCommands[selected];
    if (cmd) runCommand(cmd);
  } else {
    const p = filteredProjects[selected];
    if (p) openProject(p);
  }
}

function renderList(): void {
  if (!listEl || !inputEl) return;
  const q = inputEl.value.trim().toLowerCase();
  listEl.innerHTML = "";

  if (mode === "commands") {
    filteredCommands = filterCommands(q);
    renderCommandList();
  } else {
    // While loading, the cache is empty but `projectsLoaded` is false.
    if (!projectsLoaded) {
      const loading = document.createElement("div");
      loading.className = "p-empty";
      loading.textContent = "Scanning workspaces…";
      listEl.appendChild(loading);
      filteredProjects = [];
      updateCount();
      return;
    }
    filteredProjects = filterProjects(q);
    renderProjectList();
  }
}

function renderCommandList(): void {
  if (!listEl) return;
  if (filteredCommands.length === 0) {
    const empty = document.createElement("div");
    empty.className = "p-empty";
    empty.textContent = "No matching commands.";
    listEl.appendChild(empty);
    updateCount();
    return;
  }

  filteredCommands.forEach((cmd, i) => {
    const row = document.createElement("div");
    row.className = "p-row" + (i === selected ? " sel" : "");
    row.addEventListener("mouseenter", () => {
      if (selected === i) return;
      selected = i;
      renderList();
    });
    row.addEventListener("click", () => runCommand(cmd));

    const pic = document.createElement("span");
    pic.className = "pic";
    pic.appendChild(icon(cmd.icon, 14));
    row.appendChild(pic);

    const label = document.createElement("span");
    label.textContent = cmd.label;
    row.appendChild(label);

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = cmd.hint;
    row.appendChild(desc);

    listEl!.appendChild(row);
  });
  updateCount();
}

function renderProjectList(): void {
  if (!listEl) return;
  if (filteredProjects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "p-empty";
    empty.textContent = projectsCache.length === 0
      ? "No projects found. Add scan directories in Settings → Workspaces."
      : "No matching projects.";
    listEl.appendChild(empty);
    updateCount();
    return;
  }

  const home = guessHomeDir(projectsCache);
  filteredProjects.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "p-row" + (i === selected ? " sel" : "");
    row.addEventListener("mouseenter", () => {
      if (selected === i) return;
      selected = i;
      renderList();
    });
    row.addEventListener("click", () => openProject(p));

    const pic = document.createElement("span");
    pic.className = "pic";
    pic.appendChild(icon("folder", 14));
    row.appendChild(pic);

    const label = document.createElement("span");
    label.textContent = p.name;
    row.appendChild(label);

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = home ? p.path.replace(home, "~") : p.path;
    desc.title = p.path;
    row.appendChild(desc);

    listEl!.appendChild(row);
  });
  updateCount();
}

function filterCommands(q: string): Command[] {
  if (!q) return commands.slice();
  const score = (c: Command): number => {
    const l = c.label.toLowerCase();
    if (l.includes(q)) return l.startsWith(q) ? 100 : 80;
    if (c.keywords?.some((k) => k.toLowerCase().includes(q))) return 60;
    if (c.hint.toLowerCase().includes(q)) return 40;
    let i = 0;
    for (const ch of l) {
      if (i < q.length && ch === q[i]) i++;
      if (i >= q.length) return 20;
    }
    return 0;
  };
  return commands
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

function filterProjects(q: string): ProjectInfo[] {
  if (!q) return projectsCache.slice(0, 50);
  const score = (p: ProjectInfo): number => {
    const n = p.name.toLowerCase();
    const path = p.path.toLowerCase();
    if (n === q) return 120;
    if (n.startsWith(q)) return 100;
    if (n.includes(q)) return 80;
    if (path.includes(q)) return 50;
    // Subsequence on name (each query char appears in order).
    let i = 0;
    for (const ch of n) {
      if (i < q.length && ch === q[i]) i++;
      if (i >= q.length) return 25;
    }
    return 0;
  };
  return projectsCache
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 50)
    .map((x) => x.p);
}

function buildFooter(): HTMLElement {
  const foot = document.createElement("div");
  foot.className = "p-foot";
  foot.appendChild(footSeg("↑↓", "navigate"));
  foot.appendChild(footSeg("⏎", "select"));
  foot.appendChild(footSeg("esc", "back / close"));
  countEl = document.createElement("span");
  countEl.className = "spacer";
  foot.appendChild(countEl);
  return foot;
}

function footSeg(key: string, label: string): HTMLElement {
  const wrap = document.createElement("span");
  const b = document.createElement("b");
  b.textContent = key;
  wrap.appendChild(b);
  wrap.appendChild(document.createTextNode(" " + label));
  return wrap;
}

function updateCount(): void {
  if (!countEl) return;
  const n = currentListLength();
  const noun = mode === "commands" ? "result" : "project";
  countEl.textContent = `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function runCommand(cmd: Command): void {
  // Commands that manage their own UI state (project mode entry) skip the
  // close so the palette can be transitioned instead of dismissed.
  if (!cmd.keepOpen) hideCommandPalette();
  // setTimeout yields so any hideCommandPalette DOM removal completes
  // before the command tries to open its own overlay (avoids z-index
  // flicker with settings / launcher).
  setTimeout(() => { void cmd.run(); }, 0);
}

function openProject(p: ProjectInfo): void {
  hideCommandPalette();
  kimboBus.emit({ type: "project-opened" });
  void createTab(p.path);
}

/** Derive `$HOME` from observed project paths so we can show `~/…`
 *  relative paths in the list. No env var crosses the Tauri bridge and
 *  we don't want to plumb a whole command for one cosmetic detail. */
function guessHomeDir(list: ProjectInfo[]): string {
  for (const p of list) {
    const m = p.path.match(/^(\/Users\/[^/]+)/);
    if (m) return m[1];
    const l = p.path.match(/^(\/home\/[^/]+)/);
    if (l) return l[1];
  }
  return "";
}
