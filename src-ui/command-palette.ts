// Command palette (⌘K). Modal overlay with fuzzy search over a registered
// command list. Commands dispatch app actions directly — no shell execution.
//
// Keys: ⏎ run, esc close, ↑/↓ navigate, ⌘K toggle.

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
import { toggleLauncher } from "./launcher";

export interface Command {
  id: string;
  label: string;
  icon: IconName;
  /** Text shown on the right (shortcut or category hint). */
  hint: string;
  /** Keywords boosted during search. */
  keywords?: string[];
  run: () => void | Promise<void>;
}

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
    label: "Open project launcher",
    icon: "folder",
    hint: "⌘O",
    keywords: ["workspace", "project"],
    run: () => toggleLauncher(),
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
let selected = 0;
let filtered: Command[] = [];
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

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
  filtered = [];
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

  inputEl = document.createElement("input");
  inputEl.className = "p-input";
  inputEl.placeholder = "Type a command or search…";
  inputEl.autocomplete = "off";
  inputEl.spellcheck = false;
  inputEl.addEventListener("input", () => {
    selected = 0;
    renderList();
  });
  panel.appendChild(inputEl);

  listEl = document.createElement("div");
  listEl.className = "p-list";
  panel.appendChild(listEl);

  panel.appendChild(buildFooter());

  (document.getElementById("modal-root") ?? document.body).appendChild(overlay);

  keyHandler = (e: KeyboardEvent) => {
    if (!overlay) return;
    if (e.key === "Escape") {
      e.preventDefault();
      hideCommandPalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) return;
      selected = Math.min(selected + 1, filtered.length - 1);
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) runCommand(cmd);
    }
  };
  document.addEventListener("keydown", keyHandler, true);

  renderList();
  requestAnimationFrame(() => inputEl?.focus());
}

function renderList(): void {
  if (!listEl || !inputEl) return;
  const q = inputEl.value.trim().toLowerCase();
  filtered = filterCommands(q);
  listEl.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "p-empty";
    empty.textContent = "No matching commands.";
    listEl.appendChild(empty);
    updateCount();
    return;
  }

  filtered.forEach((cmd, i) => {
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

function buildFooter(): HTMLElement {
  const foot = document.createElement("div");
  foot.className = "p-foot";
  foot.appendChild(footSeg("↑↓", "navigate"));
  foot.appendChild(footSeg("⏎", "select"));
  foot.appendChild(footSeg("esc", "close"));
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
  countEl.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;
}

function runCommand(cmd: Command): void {
  hideCommandPalette();
  setTimeout(() => { void cmd.run(); }, 0);
}
