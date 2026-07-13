import { getCwd } from "./pty";
import { isActivatingClick } from "./window-activation";
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
import { showContextMenu } from "./theme-context-menu";
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
/** Persistent tab-button elements keyed by tab id. renderTabBar() reconciles
 *  against this map instead of tearing down the DOM every call — reusing
 *  elements is what stops the tab bar from flashing on cosmetic re-renders
 *  (badges, OSC titles, the CWD poll). */
const tabElById = new Map<number, HTMLElement>();
/** Tab currently being renamed inline; its label holds an <input> that
 *  reconciliation must not clobber. Cleared when the rename commits. */
let renamingTabId: number | null = null;

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
  // Fresh mount — drop any skeleton/element cache from a previous tabBar so
  // renderTabBar() rebuilds the skeleton against this element.
  scrollRegionEl = null;
  leftArrowEl = null;
  rightArrowEl = null;
  renamingTabId = null;
  tabElById.clear();
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
  userName?: string,
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
  if (userName) tab.userName = userName;
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
    const newTab = await createTab(rootCwd, undefined, rootScrollback, rootClaudeResume);

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
  tabs: Array<{ cwd: string | null; name: string; userName?: string }>;
  activeIndex: number;
}> {
  const snapTabs = await Promise.all(
    tabs.map(async (t) => ({
      cwd: await firstLeafCwd(t.id === activeTabId ? getTree() : t.treeSnapshot),
      name: tabDisplayName(t),
      userName: t.userName,
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
// Inline tab rename
// ---------------------------------------------------------------------------

/** Replace the tab label with an inline <input> that commits on Enter/blur
 *  or cancels on Escape. An empty value clears `userName` so the tab reverts
 *  to its automatic name. Committed names are capped at 64 characters. */
export function beginRenameTab(tabId: number): void {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const el = tabBarEl.querySelector<HTMLElement>(`[data-tab-id="${tabId}"] .tab-label`);
  if (!el) return;
  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.value = tabDisplayName(tab);
  input.spellcheck = false;
  renamingTabId = tabId;
  // Guard against double-commit: removing the focused input synchronously fires
  // its blur handler. Without this flag, Escape (commit(false)) would re-enter
  // via blur as commit(true) and wrongly save the edit.
  let committed = false;
  const commit = (save: boolean) => {
    if (committed) return;
    committed = true;
    if (save) {
      const v = input.value.trim();
      tab.userName = v.length > 0 ? v.slice(0, 64) : undefined;
    }
    // Clear the guard and drop the input before re-rendering so reconciliation
    // repaints the label with the committed name (updateTabEl skips a label
    // that still hosts the rename input).
    renamingTabId = null;
    input.remove();
    renderTabBar();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  input.addEventListener("blur", () => commit(true));
  el.replaceChildren(input);
  input.focus();
  input.select();
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

/** Build the static tab-bar chrome (arrows, scroll region, new-tab button)
 *  exactly once per mount. Returns early if the skeleton is already attached
 *  to the current tabBarEl. Rebuilding this every render was the source of the
 *  flashing; now only tab buttons churn, and only when they actually change. */
function ensureSkeleton() {
  if (scrollRegionEl && scrollRegionEl.parentElement === tabBarEl) return;
  tabBarEl.innerHTML = "";
  tabElById.clear();

  const leftArrow = document.createElement("button");
  leftArrow.type = "button";
  leftArrow.className = "tab-scroll-arrow left";
  leftArrow.appendChild(icon("chevron-l", 12, 1.5));
  leftArrow.addEventListener("click", () => scrollByOneTab(-1));
  leftArrowEl = leftArrow;

  const scrollRegion = document.createElement("div");
  scrollRegion.className = "tab-scroll-region";
  scrollRegionEl = scrollRegion;

  const rightArrow = document.createElement("button");
  rightArrow.type = "button";
  rightArrow.className = "tab-scroll-arrow right";
  rightArrow.appendChild(icon("chevron-r", 12, 1.5));
  rightArrow.addEventListener("click", () => scrollByOneTab(1));
  rightArrowEl = rightArrow;

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "tab-new";
  newBtn.title = "New tab (⌘T)";
  newBtn.appendChild(icon("plus", 14));
  newBtn.addEventListener("click", () => createTab());

  // Arrows are absolute overlays (see .tab-scroll-arrow in style.css); DOM
  // order among them is irrelevant. The scroll region + new-tab button are the
  // only flex children.
  tabBarEl.append(leftArrow, scrollRegion, rightArrow, newBtn);
}

/** Create the persistent DOM for one tab. Listeners are wired once here and
 *  survive across re-renders because the element is cached in tabElById. The
 *  handlers close over `tabId` (stable), never over the tab's array index. */
function createTabEl(tabId: number): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "tab";
  el.dataset.tabId = String(tabId);

  const idx = document.createElement("span");
  idx.className = "tab-index";
  el.appendChild(idx);

  const label = document.createElement("span");
  label.className = "tab-label";
  el.appendChild(label);

  const close = document.createElement("span");
  close.className = "tab-close";
  close.title = "Close (⌘⇧W)";
  close.appendChild(icon("close", 10, 2));
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    // Ignore the click that just activated a background window so it can't
    // accidentally close a tab while the user was only bringing Kimbo
    // forward (acceptFirstMouse makes that click live over the chrome).
    if (isActivatingClick()) return;
    closeTab(tabId);
  });
  el.appendChild(close);

  el.addEventListener("click", () => {
    if (!wasJustDragging()) switchTab(tabId);
  });
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    beginRenameTab(tabId);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([{ label: "Rename", onClick: () => beginRenameTab(tabId) }], e.clientX, e.clientY);
  });
  return el;
}

const BADGE_KINDS: BadgeKind[] = ["stop", "perm", "bell"];

/** Patch a cached tab element to match current tab state without recreating it. */
function updateTabEl(el: HTMLElement, tab: Tab, index: number) {
  el.classList.toggle("active", tab.id === activeTabId);
  const badge = tabBadge.get(tab.id) ?? null;
  el.classList.toggle("tab--badge", badge !== null);
  for (const kind of BADGE_KINDS) {
    el.classList.toggle(`tab--badge-${kind}`, badge === kind);
  }
  el.dataset.tabIndex = String(index);

  const displayName = tabDisplayName(tab);
  if (el.title !== displayName) el.title = displayName;

  const idx = el.querySelector<HTMLElement>(".tab-index")!;
  const idxText = String(index + 1);
  if (idx.textContent !== idxText) idx.textContent = idxText;

  // Skip the label while it hosts a live rename <input> so we don't clobber
  // the user's in-progress edit on a background re-render.
  if (renamingTabId !== tab.id) {
    const label = el.querySelector<HTMLElement>(".tab-label")!;
    if (label.textContent !== displayName) label.textContent = displayName;
  }

  // Single tab can't be closed; hide (don't remove) its close affordance.
  const close = el.querySelector<HTMLElement>(".tab-close")!;
  close.style.display = tabs.length > 1 ? "" : "none";
}

function renderTabBar() {
  cancelDrag();
  ensureSkeleton();
  const region = scrollRegionEl!;

  // Drop elements for tabs that no longer exist.
  for (const [id, el] of tabElById) {
    if (!tabs.some((t) => t.id === id)) {
      el.remove();
      tabElById.delete(id);
    }
  }

  // Upsert + order each tab, reusing cached elements.
  tabs.forEach((tab, i) => {
    let el = tabElById.get(tab.id);
    if (!el) {
      el = createTabEl(tab.id);
      tabElById.set(tab.id, el);
    }
    if (region.children[i] !== el) {
      region.insertBefore(el, region.children[i] ?? null);
    }
    updateTabEl(el, tab, i);
  });

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
  if (!active) return;

  // Only correct the scroll position when the active tab is actually clipped.
  // Calling this on every render (badges, OSC titles, the CWD poll) with a
  // smooth scrollIntoView is what made the bar slide continuously; an instant,
  // conditional nudge here is a no-op once the tab is already visible.
  const viewLeft = scrollRegionEl.scrollLeft;
  const viewRight = viewLeft + scrollRegionEl.clientWidth;
  const tabLeft = active.offsetLeft;
  const tabRight = tabLeft + active.offsetWidth;

  if (tabLeft < viewLeft) {
    scrollRegionEl.scrollLeft = tabLeft;
  } else if (tabRight > viewRight) {
    scrollRegionEl.scrollLeft = tabRight - scrollRegionEl.clientWidth;
  }
}

/** Override or clear the title for a given session's tab. Pass null to revert
    to the default tab name. The argument is the *terminal session* id (not
    the tab id) since OSC 0/2 fires from a terminal.

    This is a hot path: codex (and other TUIs) animate a spinner in the
    terminal title at ~10 updates/sec for minutes at a time. It must NOT go
    through renderTabBar() — a full innerHTML rebuild destroys the button
    under the cursor, which restarts the hover transitions every frame
    (visible flicker) and swallows clicks whose mousedown/mouseup straddle
    a rebuild. Patch the existing button in place instead. */
export function setTabTitle(sessionId: number, title: string | null): void {
  const tab = findTabBySessionId(sessionId);
  if (!tab) return;
  const next = title ?? undefined;
  if (tab.titleOverride === next) return;
  tab.titleOverride = next;
  updateTabButtonInPlace(tab);
}

/** Refresh one tab button's label/tooltip without rebuilding the tab bar.
 *  Falls back to a full render when the button isn't mounted (shouldn't
 *  happen — every tab mutation renders — but a rebuild is always correct). */
function updateTabButtonInPlace(tab: Tab): void {
  const el = tabBarEl?.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`);
  if (!el) {
    renderTabBar();
    return;
  }
  const displayName = tabDisplayName(tab);
  el.title = displayName;
  const label = el.querySelector<HTMLElement>(".tab-label");
  // Leave the label alone while an inline rename <input> owns it; the next
  // full render repaints the display name after the rename commits.
  if (label && !label.querySelector(".tab-rename-input") && label.textContent !== displayName) {
    label.textContent = displayName;
  }
  // A longer/shorter title can change the tab's width and thus overflow.
  updateScrollArrows();
  try { renderTitle(); } catch (_) { /* title-bar may not be mounted yet */ }
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
