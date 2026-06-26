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
  getActivePaneId,
  splitLeaf,
} from "./panes";
import { kimboBus } from "./kimbo-bus";
import { icon } from "./icons";
import { renderTitle } from "./title-bar";
import { initTabDrag, cancelDrag, wasJustDragging } from "./tab-drag";
import {
  pushClosedTab,
  popClosedTab,
  shapeFromTreeAsync,
  firstLeafCwd as firstLeafCwdOfShape,
  firstLeafScrollback,
  firstLeafClaudeResume,
  type ClosedTabShape,
} from "./closed-tabs";

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
  /** User-set name; sticky and highest priority. */
  userName?: string;
}

/** Display-name priority: userName > titleOverride > name. */
export function tabDisplayName(t: { userName?: string; titleOverride?: string; name: string }): string {
  return t.userName ?? t.titleOverride ?? t.name;
}

let tabs: Tab[] = [];
let activeTabId = -1;
let nextTabId = 1;
let tabBarEl: HTMLElement;
let terminalAreaEl: HTMLElement;
let scrollRegionEl: HTMLElement | null = null;
let leftArrowEl: HTMLElement | null = null;
let rightArrowEl: HTMLElement | null = null;

type BadgeKind = "stop" | "perm" | "bell" | null;
const tabBadge: Map<number, BadgeKind> = new Map();

/** Set the badge state for a tab. Permission wins over stop/bell; stop wins
 *  over bell. Pass null to clear. Triggers a tab-bar re-render. */
export function setTabBadge(tabId: number, kind: BadgeKind): void {
  if (kind === null) {
    tabBadge.delete(tabId);
  } else {
    const existing = tabBadge.get(tabId);
    if (existing === "perm") return; // perm wins
    if (existing === "stop" && kind === "bell") return; // stop wins over bell
    tabBadge.set(tabId, kind);
  }
  renderTabBar();
}

/** Read-only — used by claude-notifications.ts. */
export function getTabBadge(tabId: number): BadgeKind {
  return tabBadge.get(tabId) ?? null;
}

/** Badge the tab that owns a given terminal session. Reuses findTabBySessionId
 *  so the caller doesn't need to know the tab id. */
export function setTabBadgeForSession(sessionId: number, kind: BadgeKind): void {
  const tab = findTabBySessionId(sessionId);
  if (tab) setTabBadge(tab.id, kind);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let tabNamePoller: ReturnType<typeof setInterval> | null = null;

export function initTabs(tabBar: HTMLElement, terminalArea: HTMLElement) {
  tabBarEl = tabBar;
  terminalAreaEl = terminalArea;
  initPanes(terminalArea);

  tabBarEl.addEventListener("scroll", () => updateScrollArrows(), { capture: true });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => updateScrollArrows());
    ro.observe(tabBarEl);
  }

  initTabDrag(tabBarEl);

  // Periodically update active tab name from shell CWD.
  if (tabNamePoller !== null) clearInterval(tabNamePoller);
  tabNamePoller = setInterval(async () => {
    const session = getActiveSession();
    const tab = getActiveTab();
    if (!session || !tab) return;
    if (tab.titleOverride != null || tab.userName != null) return;
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
}

/** Stop the tab-name polling interval. Called on teardown. */
export function disposeTabs(): void {
  if (tabNamePoller !== null) {
    clearInterval(tabNamePoller);
    tabNamePoller = null;
  }
}

export async function createTab(
  cwd?: string,
  restoredScrollback?: string,
  restoredClaudeResume?: { uuid: string },
): Promise<Tab> {
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
  const rootPane = await createRootPane(cwd, restoredScrollback, restoredClaudeResume);

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
  tabBadge.delete(id);

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

export async function closeTab(id: number): Promise<void> {
  cancelDrag();
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];

  // Snapshot the tab's pane-tree shape onto the closed-tab stack BEFORE
  // we dispose anything. shapeFromTreeAsync also runs the per-leaf
  // claude-session probe in parallel — must complete before disposeTree
  // because the probe needs the shell's descendants to still be alive.
  const liveTree = tab.id === activeTabId ? getTree() : tab.treeSnapshot;
  if (liveTree) {
    const shape = await shapeFromTreeAsync(liveTree);
    pushClosedTab({
      shape,
      name: tab.name,
      titleOverride: tab.titleOverride,
      originalIndex: idx,
    });
  }

  // Dispose every pane session inside this tab BEFORE detaching the DOM, so
  // closing a tab doesn't leave PTY processes dangling. Reuse the captured
  // `liveTree` instead of re-evaluating `tab.id === activeTabId` here:
  // shapeFromTreeAsync awaits ~100ms, during which a tab switch could flip
  // the active id and mutate the panes module's tree, leaving us disposing
  // the wrong subtree.
  disposeTree(liveTree);

  tab.container.remove();
  tabs.splice(idx, 1);

  if (activeTabId === id) {
    const newActive = tabs[Math.min(idx, tabs.length - 1)];
    switchTab(newActive.id);
  }
  renderTabBar();
}

// ---------------------------------------------------------------------------
// Reopen recently closed tab (⌘⇧T)
// ---------------------------------------------------------------------------

/** Re-entrancy guard. createTab + splitLeaf are async, so a user spamming
 *  ⌘⇧T could trigger overlapping reopens. The flag is cleared in `finally`
 *  so a sync re-press after the previous one settles works as expected. */
let reopening = false;

/** Pop the top closed-tab entry and reconstruct it. No-op on empty stack
 *  or if a previous reopen is still in flight.
 *
 *  Reconstruction shape:
 *   1. createTab(rootCwd) — spawns a fresh tab with one leaf at the saved
 *      first-leaf cwd. createTab handles all the existing tab-creation
 *      machinery (DOM container, panes init, default name).
 *   2. If the saved shape is a split, walk it recursively, calling
 *      splitLeaf at each split node to materialize the layout.
 *   3. Slide the tab back to its original index if there's room.
 *   4. Restore titleOverride if the closed tab had a shell-set title. */
export async function reopenLastClosedTab(): Promise<void> {
  if (reopening) return;
  reopening = true;
  try {
    const entry = popClosedTab();
    if (!entry) return;

    const rootCwd = firstLeafCwdOfShape(entry.shape) ?? undefined;
    const rootScrollback = firstLeafScrollback(entry.shape);
    const rootClaudeResume = firstLeafClaudeResume(entry.shape);
    const newTab = await createTab(rootCwd, rootScrollback, rootClaudeResume);

    if (entry.shape.type === "split") {
      const rootLeafId = getActivePaneId();
      await replayShape(entry.shape, rootLeafId);
    }

    // Slide the just-created tab (currently last) to the original slot
    // if it's still in range. reorderTab handles the DOM and array
    // reorder. If originalIndex is out of range, we leave it at the end —
    // strictly less convenient than perfect placement but never wrong.
    const currentIdx = tabs.findIndex((t) => t.id === newTab.id);
    if (
      currentIdx !== -1 &&
      entry.originalIndex >= 0 &&
      entry.originalIndex < currentIdx
    ) {
      reorderTab(currentIdx, entry.originalIndex);
    }

    // Restore shell-set title last. After reorderTab, newTab is still the
    // same object reference even if its array index changed.
    if (entry.titleOverride) {
      newTab.titleOverride = entry.titleOverride;
      renderTabBar();
    }
  } finally {
    reopening = false;
  }
}

/** Recursively materialize a saved shape onto a target leaf in the
 *  CURRENT tab's tree. The contract: when called with `(shape,
 *  targetLeafId)`, the leaf identified by targetLeafId already has the
 *  correct cwd for shape's leftmost leaf (createTab seeded it for the
 *  root call; splitLeaf seeds it for inner calls because it returns
 *  firstId === the original leaf).
 *
 *  Base case: shape is a leaf — nothing to do.
 *  Recursive case: split the target with cwd = firstLeafCwdOfShape(shape.second),
 *  then recurse onto both children. */
async function replayShape(
  shape: ClosedTabShape,
  targetLeafId: number,
): Promise<void> {
  if (shape.type === "leaf") return;

  const cwd = firstLeafCwdOfShape(shape.second) ?? undefined;
  const scrollback = firstLeafScrollback(shape.second);
  const claudeResume = firstLeafClaudeResume(shape.second);
  const result = await splitLeaf(targetLeafId, shape.axis, cwd, scrollback, claudeResume);
  if (!result) {
    console.warn("replayShape: target leaf disappeared", targetLeafId);
    return;
  }

  await replayShape(shape.first, result.firstId);
  await replayShape(shape.second, result.secondId);
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

export function reorderTab(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= tabs.length) return;
  if (toIndex < 0 || toIndex >= tabs.length) return;
  const [tab] = tabs.splice(fromIndex, 1);
  tabs.splice(toIndex, 0, tab);
  renderTabBar();
}

export function getActiveTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

export function findTabById(tabId: number): Tab | undefined {
  return tabs.find((t) => t.id === tabId);
}

/** Snapshot of every open tab for session persistence. Returns the active
 *  tab's index and each tab's first-leaf cwd (what we'll restore to on
 *  next launch). Panes/splits collapse to a single cwd — restoring the
 *  full split geometry would need a much bigger serialization + replay
 *  effort and isn't in scope for the MVP of `startup === "last"`. */
export async function snapshotOpenTabs(): Promise<{
  tabs: Array<{ cwd: string | null; name: string }>;
  activeIndex: number;
}> {
  const snapTabs = await Promise.all(
    tabs.map(async (t) => ({
      cwd: await firstLeafCwd(t.id === activeTabId ? getTree() : t.treeSnapshot),
      name: tabDisplayName(t),
    })),
  );
  return {
    tabs: snapTabs,
    activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTabId)),
  };
}

/** Resolve the first leaf's working directory for session persistence.
 *  Prefers the OS-level cwd queried from the shell pid (`get_cwd` →
 *  proc_pidinfo / /proc), which is authoritative and works on EVERY shell.
 *  Falls back to `session.cwd` — the OSC-7 value, only populated when the
 *  shell emits OSC 7 on each prompt (oh-my-zsh and friends do; a bare shell
 *  does not). Returns null for trees with no leaf (shouldn't happen) or when
 *  neither source knows the cwd (caller falls back to the default). */
async function firstLeafCwd(node: any): Promise<string | null> {
  const leaf = firstLeaf(node);
  if (!leaf) return null;
  try {
    const osCwd = await getCwd(leaf.session.ptyId);
    if (osCwd) return osCwd;
  } catch (_) { /* fall through to the OSC-7 value */ }
  return leaf.session?.cwd ?? null;
}

/** Walk a pane tree to its first leaf node (depth-first, first subtree
 *  preferred). Returns null for an empty/absent tree. */
function firstLeaf(node: any): any | null {
  if (!node) return null;
  if (node.type === "leaf") return node;
  return firstLeaf(node.first) ?? firstLeaf(node.second);
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
      out.push({ tabName: tabDisplayName(t), ptyId: leaf.session.ptyId });
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
  cancelDrag();
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
    const badge = tabBadge.get(tab.id) ?? null;
    const badgeCls = badge ? ` tab--badge tab--badge-${badge}` : "";
    el.className = "tab" + (tab.id === activeTabId ? " active" : "") + badgeCls;
    el.type = "button";
    el.dataset.tabId = String(tab.id);
    el.dataset.tabIndex = String(i);
    const displayName = tabDisplayName(tab);
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

    el.addEventListener("click", () => {
      if (!wasJustDragging()) switchTab(tab.id);
    });
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

/** Find the tabId that owns a given paneId. Used by claude-notifications.ts
 *  to route socket events to the right tab. */
export function findTabIdByPaneId(paneId: number): number | null {
  for (const t of tabs) {
    const tree = t.id === activeTabId ? getTree() : t.treeSnapshot;
    if (treeContainsPane(tree, paneId)) return t.id;
  }
  return null;
}

function treeContainsPane(node: any, paneId: number): boolean {
  if (!node) return false;
  if (node.type === "leaf") return node.paneId === paneId;
  return treeContainsPane(node.first, paneId) || treeContainsPane(node.second, paneId);
}
