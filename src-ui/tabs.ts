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
  disposeTree,
} from "./panes";
import { kimboBus } from "./kimbo-bus";
import { icon } from "./icons";
import { renderTitle } from "./title-bar";

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

export interface Tab {
  id: number;
  name: string;
  container: HTMLElement;
  /** Opaque reference — panes.ts owns the tree state per-tab. */
  treeSnapshot: any;
  /** Title set by the shell or running program via OSC 0/2; trumps `name` when present. */
  titleOverride?: string;
}

let tabs: Tab[] = [];
let activeTabId = -1;
let nextTabId = 1;
let tabBarEl: HTMLElement;
let terminalAreaEl: HTMLElement;
let scrollRegionEl: HTMLElement | null = null;
let leftArrowEl: HTMLElement | null = null;
let rightArrowEl: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initTabs(tabBar: HTMLElement, terminalArea: HTMLElement) {
  tabBarEl = tabBar;
  terminalAreaEl = terminalArea;
  initPanes(terminalArea);

  tabBarEl.addEventListener("scroll", () => updateScrollArrows(), { capture: true });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => updateScrollArrows());
    ro.observe(tabBarEl);
  }
}

export async function createTab(cwd?: string): Promise<Tab> {
  // If no explicit cwd, inherit from the currently active session
  // (OSC 7 first, PTY query as fallback) so Cmd+T opens "where I am".
  if (cwd === undefined) {
    const active = getActiveSession();
    if (active) {
      if (active.cwd) {
        cwd = active.cwd;
      } else {
        try {
          const c = await getCwd(active.ptyId);
          if (c) cwd = c;
        } catch (_) { /* ignore */ }
      }
    }
  }

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

  const name = cwd ? (cwd.replace(/\/$/, "").split("/").pop() || "~") : "~";
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

  // Dispose every pane session inside this tab BEFORE detaching the DOM, so
  // closing a tab doesn't leave PTY processes dangling. The active tab's
  // live tree is in the panes module; inactive tabs keep a snapshot.
  disposeTree(tab.id === activeTabId ? getTree() : tab.treeSnapshot);

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

/** Snapshot of every open tab for session persistence. Returns the active
 *  tab's index and each tab's first-leaf cwd (what we'll restore to on
 *  next launch). Panes/splits collapse to a single cwd — restoring the
 *  full split geometry would need a much bigger serialization + replay
 *  effort and isn't in scope for the MVP of `startup === "last"`. */
export function snapshotOpenTabs(): {
  tabs: Array<{ cwd: string | null; name: string }>;
  activeIndex: number;
} {
  return {
    tabs: tabs.map((t) => ({
      cwd: firstLeafCwd(t.id === activeTabId ? getTree() : t.treeSnapshot),
      name: t.titleOverride ?? t.name,
    })),
    activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTabId)),
  };
}

/** Walk a pane tree and return the first leaf's last-known cwd. OSC 7
 *  writes `session.cwd` on every shell prompt, so this is the same value
 *  the pane-head strip displays. Returns null for trees that have no leaf
 *  (shouldn't happen in practice) or whose first leaf hasn't emitted OSC 7
 *  yet (fresh shell — caller should fall back to the default). */
function firstLeafCwd(node: any): string | null {
  if (!node) return null;
  if (node.type === "leaf") return node.session?.cwd ?? null;
  return firstLeafCwd(node.first) ?? firstLeafCwd(node.second);
}

/** Total number of open tabs. Used by confirm-quit to decide whether the
 *  user has "active work" that's worth a confirmation dialog. */
export function getTabCount(): number {
  return tabs.length;
}

/** Total number of panes across every tab (splits counted separately).
 *  Walks the live tree for the active tab and each inactive tab's stored
 *  treeSnapshot. Used alongside getTabCount to detect a multi-pane /
 *  multi-tab session worth confirming on quit. */
export function countPanesAcrossTabs(): number {
  let n = 0;
  for (const t of tabs) {
    const tree = t.id === activeTabId ? getTree() : t.treeSnapshot;
    n += countLeaves(tree);
  }
  return n;
}

function countLeaves(node: any): number {
  if (!node) return 0;
  if (node.type === "leaf") return 1;
  return countLeaves(node.first) + countLeaves(node.second);
}

/** Enumerate every open pane with its owning tab's display name. Used by
 *  the quit-confirm flow to tell the user *which* pane is running
 *  something — "vim is running in Project X / pane 2" reads better than
 *  a bare pane-count. */
export interface PaneRef {
  tabName: string;
  ptyId: number;
}

export function collectOpenPanes(): PaneRef[] {
  const out: PaneRef[] = [];
  for (const t of tabs) {
    const tree = t.id === activeTabId ? getTree() : t.treeSnapshot;
    walkLeaves(tree, (leaf) => {
      out.push({ tabName: t.titleOverride ?? t.name, ptyId: leaf.session.ptyId });
    });
  }
  return out;
}

function walkLeaves(node: any, visit: (leaf: any) => void): void {
  if (!node) return;
  if (node.type === "leaf") { visit(node); return; }
  walkLeaves(node.first, visit);
  walkLeaves(node.second, visit);
}

// Pane operations forwarded from keys.ts.
export function splitActive(dir: "vertical" | "horizontal"): void {
  _splitActive(dir);
  kimboBus.emit({ type: "pane-split" });
}
export { closeActive, focusDirection, getActiveSession, fitAllPanes, getTree };

/**
 * Cmd+W behavior: close the active pane if we're inside a split, otherwise
 * close the whole tab. `closeActive()` alone silently bails out on a single
 * pane (so the terminal + its square stick around), which isn't what a
 * macOS user expects from Cmd+W.
 *
 * Re-entrancy guard: on macOS, one physical Cmd+W can reach this function
 * TWICE — once via the native-menu accelerator (Tauri "menu-action" event →
 * main.ts listener) and once via the webview keydown handler (keys.ts).
 * Without the guard, the first call collapses a 2-pane split into a leaf
 * and the second call then closes the whole tab — the user sees "Cmd+W
 * closed the pane AND then the tab" on a single press. The flag resets on
 * the next animation frame, which is longer than the menu-event delivery
 * gap but far shorter than a human double-press, so intentional repeat
 * presses are unaffected.
 */
let closeInFlight = false;
export function closeActiveOrTab(): void {
  if (closeInFlight) return;
  closeInFlight = true;
  requestAnimationFrame(() => { closeInFlight = false; });

  const t = getTree();
  if (t && t.type === "split") {
    closeActive();
    return;
  }
  const tab = getActiveTab();
  if (tab) closeTab(tab.id);
}

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

  // Left scroll arrow
  const leftArrow = document.createElement("button");
  leftArrow.type = "button";
  leftArrow.className = "tab-scroll-arrow left";
  leftArrow.appendChild(icon("chevron-l", 12, 1.5));
  leftArrow.addEventListener("click", () => scrollByOneTab(-1));
  tabBarEl.appendChild(leftArrow);
  leftArrowEl = leftArrow;

  // Scroll region (holds all tab buttons)
  const scrollRegion = document.createElement("div");
  scrollRegion.className = "tab-scroll-region";
  tabBarEl.appendChild(scrollRegion);
  scrollRegionEl = scrollRegion;

  tabs.forEach((tab, i) => {
    const el = document.createElement("button");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");
    el.type = "button";
    el.dataset.tabId = String(tab.id);
    el.dataset.tabIndex = String(i);
    const displayName = tab.titleOverride ?? tab.name;
    el.title = displayName;

    const idx = document.createElement("span");
    idx.className = "tab-index";
    idx.textContent = String(i + 1);
    el.appendChild(idx);

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = displayName;
    el.appendChild(label);

    if (tabs.length > 1) {
      const close = document.createElement("span");
      close.className = "tab-close";
      close.title = "Close (⌘⇧W)";
      close.appendChild(icon("close", 10, 2));
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.appendChild(close);
    }

    el.addEventListener("click", () => switchTab(tab.id));
    scrollRegion.appendChild(el);
  });

  // Right scroll arrow
  const rightArrow = document.createElement("button");
  rightArrow.type = "button";
  rightArrow.className = "tab-scroll-arrow right";
  rightArrow.appendChild(icon("chevron-r", 12, 1.5));
  rightArrow.addEventListener("click", () => scrollByOneTab(1));
  tabBarEl.appendChild(rightArrow);
  rightArrowEl = rightArrow;

  // New tab button (pinned outside scroll region)
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "tab-new";
  newBtn.title = "New tab (⌘T)";
  newBtn.appendChild(icon("plus", 14));
  newBtn.addEventListener("click", () => createTab());
  tabBarEl.appendChild(newBtn);

  updateScrollArrows();
  scrollActiveTabIntoView();

  try { renderTitle(); } catch (_) { /* title-bar may not be mounted yet */ }
}

function scrollByOneTab(direction: number) {
  if (!scrollRegionEl) return;
  const firstTab = scrollRegionEl.querySelector(".tab") as HTMLElement | null;
  const tabWidth = firstTab ? firstTab.offsetWidth + 2 : 200;
  scrollRegionEl.scrollBy({ left: direction * tabWidth, behavior: "smooth" });
}

function updateScrollArrows() {
  if (!scrollRegionEl || !leftArrowEl || !rightArrowEl) return;
  const { scrollLeft, scrollWidth, clientWidth } = scrollRegionEl;
  const overflows = scrollWidth > clientWidth;
  leftArrowEl.classList.toggle("visible", overflows && scrollLeft > 0);
  rightArrowEl.classList.toggle("visible", overflows && scrollLeft + clientWidth < scrollWidth - 1);
}

function scrollActiveTabIntoView() {
  if (!scrollRegionEl) return;
  const active = scrollRegionEl.querySelector(".tab.active") as HTMLElement | null;
  if (active && typeof active.scrollIntoView === "function") {
    active.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }
}

// Periodically update active tab name from shell CWD.
setInterval(async () => {
  const session = getActiveSession();
  const tab = getActiveTab();
  if (!session || !tab) return;
  if (tab.titleOverride != null) return;
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

/** Override or clear the title for a given session's tab. Pass null to revert
    to the default tab name. The argument is the *terminal session* id (not
    the tab id) since OSC 0/2 fires from a terminal. */
export function setTabTitle(sessionId: number, title: string | null): void {
  const tab = findTabBySessionId(sessionId);
  if (!tab) return;
  tab.titleOverride = title ?? undefined;
  renderTabBar();
}

function findTabBySessionId(sessionId: number): Tab | undefined {
  for (const tab of tabs) {
    const tree = tab.id === activeTabId ? getTree() : tab.treeSnapshot;
    if (treeContainsSession(tree, sessionId)) return tab;
  }
  return undefined;
}

function treeContainsSession(node: any, sessionId: number): boolean {
  if (!node) return false;
  if (node.type === "leaf") return node.session?.id === sessionId;
  if (node.type === "split") {
    return treeContainsSession(node.first, sessionId) || treeContainsSession(node.second, sessionId);
  }
  return false;
}
