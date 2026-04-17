import { getCwd } from "./pty";
import {
  initPanes,
  createRootPane,
  splitActive as _splitActive,
  closeActive,
  focusDirection,
  getActiveSession,
  fitAllPanes,
  getTree,
  setTree,
} from "./panes";
import { kimboBus } from "./kimbo-bus";

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

export interface Tab {
  id: number;
  name: string;
  container: HTMLElement;
  /** Opaque reference — panes.ts owns the tree state per-tab. */
  treeSnapshot: any;
}

let tabs: Tab[] = [];
let activeTabId = -1;
let nextTabId = 1;
let tabBarEl: HTMLElement;
let terminalAreaEl: HTMLElement;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initTabs(tabBar: HTMLElement, terminalArea: HTMLElement) {
  tabBarEl = tabBar;
  terminalAreaEl = terminalArea;
  initPanes(terminalArea);
}

export async function createTab(cwd?: string): Promise<Tab> {
  const id = nextTabId++;

  // Save current tab's pane tree before switching.
  saveCurrentTabTree();

  // Create a container for this tab.
  const container = document.createElement("div");
  container.className = "tab-terminal-container";
  container.style.display = "flex";
  container.style.flex = "1";
  container.style.minHeight = "0";
  container.style.minWidth = "0";
  terminalAreaEl.appendChild(container);

  // Hide all other tab containers.
  hideAllContainers();
  container.style.display = "flex";

  // Re-init panes module to use this container, create root pane.
  initPanes(container);
  const rootPane = await createRootPane(cwd);

  const name = cwd ? cwd.split("/").pop() || "~" : "~";
  const tab: Tab = { id, name, container, treeSnapshot: null };
  tabs.push(tab);

  activeTabId = id;
  renderTabBar();
  kimboBus.emit({ type: "tab-created" });
  return tab;
}

export function switchTab(id: number) {
  if (id === activeTabId) return;

  // Save current tab's tree.
  saveCurrentTabTree();

  // Hide all, show target.
  hideAllContainers();

  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  tab.container.style.display = "flex";
  activeTabId = id;

  // Restore pane tree for this tab.
  initPanes(tab.container);
  setTree(tab.treeSnapshot);

  // Re-fit after switching.
  requestAnimationFrame(() => {
    fitAllPanes();
    const session = getActiveSession();
    if (session) session.term.focus();
  });

  renderTabBar();
}

export function closeTab(id: number) {
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  tab.container.remove();
  tabs.splice(idx, 1);

  if (activeTabId === id) {
    const newActive = tabs[Math.min(idx, tabs.length - 1)];
    switchTab(newActive.id);
  }
  renderTabBar();
}

export function nextTab() {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const next = tabs[(idx + 1) % tabs.length];
  switchTab(next.id);
}

export function prevTab() {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
  switchTab(prev.id);
}

export function switchToTab(n: number) {
  if (n >= 0 && n < tabs.length) {
    switchTab(tabs[n].id);
  }
}

export function getActiveTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

// Pane operations forwarded from keys.ts.
export function splitActive(dir: "vertical" | "horizontal"): void {
  _splitActive(dir);
  kimboBus.emit({ type: "pane-split" });
}
export { closeActive, focusDirection, getActiveSession, fitAllPanes };

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function saveCurrentTabTree() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (tab) {
    tab.treeSnapshot = getTree();
  }
}

function hideAllContainers() {
  for (const tab of tabs) {
    tab.container.style.display = "none";
  }
}

function renderTabBar() {
  tabBarEl.innerHTML = "";

  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");
    el.textContent = tab.name;

    if (tabs.length > 1) {
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "\u00d7";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.appendChild(close);
    }

    el.addEventListener("click", () => switchTab(tab.id));
    tabBarEl.appendChild(el);
  }

  const newBtn = document.createElement("div");
  newBtn.className = "tab-new";
  newBtn.textContent = "+";
  newBtn.addEventListener("click", () => createTab());
  tabBarEl.appendChild(newBtn);
}

// Periodically update active tab name from shell CWD.
setInterval(async () => {
  const session = getActiveSession();
  const tab = getActiveTab();
  if (!session || !tab) return;
  try {
    const cwd = await getCwd(session.ptyId);
    if (cwd) {
      const home = cwd.replace(/^\/Users\/[^/]+/, "~");
      const name = home === "~" ? "~" : home.split("/").pop() || "~";
      if (tab.name !== name) {
        tab.name = name;
        renderTabBar();
      }
    }
  } catch (_) { /* ignore */ }
}, 2000);
