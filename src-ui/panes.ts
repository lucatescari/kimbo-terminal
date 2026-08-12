import { createTerminalSession, TerminalSession } from "./terminal";
import { getCwd } from "./pty";
import { attachSplitHandleDrag } from "./split-handle-drag";
import { chooseHudAction } from "./claude-hud-visibility";

// ---------------------------------------------------------------------------
// Split tree types
// ---------------------------------------------------------------------------

type SplitAxis = "vertical" | "horizontal";

interface LeafNode {
  type: "leaf";
  paneId: number;
  session: TerminalSession;
  element: HTMLElement;
}

interface SplitNode {
  type: "split";
  axis: SplitAxis;
  first: PaneTree;
  second: PaneTree;
  element: HTMLElement;
}

type PaneTree = LeafNode | SplitNode;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let nextPaneId = 1;
let tree: PaneTree | null = null;
let activePaneId = -1;
let rootEl: HTMLElement;
let installAttempted = false;

type PaneBadgeKind = "stop" | "perm" | null;
const paneBadge: Map<number, PaneBadgeKind> = new Map();

export function setPaneBadge(paneId: number, kind: PaneBadgeKind): void {
  if (kind === null) {
    paneBadge.delete(paneId);
  } else {
    const existing = paneBadge.get(paneId);
    if (existing === "perm") return; // perm wins
    paneBadge.set(paneId, kind);
  }
  if (!tree) return;
  const leaf = findLeaf(tree, paneId);
  if (leaf) {
    const head = leaf.element.querySelector<HTMLElement>(":scope > .pane-head");
    if (head) applyPaneBadgeClass(head, kind);
  }
}

function applyPaneBadgeClass(head: HTMLElement, kind: PaneBadgeKind): void {
  head.classList.remove("pane-head--badge", "pane-head--badge-stop", "pane-head--badge-perm");
  if (kind) {
    head.classList.add("pane-head--badge", `pane-head--badge-${kind}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initPanes(terminalArea: HTMLElement) {
  rootEl = terminalArea;
}

/** Create the initial pane (called once at startup, and on tab open). The
 *  optional restoredScrollback is used by the reopen-closed-tab feature
 *  to seed the new pane's terminal with the saved buffer state. */
export async function createRootPane(
  cwd?: string,
  restoredScrollback?: string,
  restoredClaudeResume?: { uuid: string },
): Promise<LeafNode> {
  // createLeaf attaches the .pane element to rootEl before awaiting
  // xterm setup so scrollback replay has correct viewport dimensions.
  const node = await createLeaf({ parentEl: rootEl, cwd, restoredScrollback, restoredClaudeResume });
  tree = node;
  setActivePane(node.paneId);
  return node;
}

/** Split the active pane along the given axis. */
export async function splitActive(axis: SplitAxis): Promise<void> {
  if (!tree) return;
  const leaf = findLeaf(tree, activePaneId);
  if (!leaf) return;

  // Inherit CWD from the active pane. Prefer the OSC 7 value (faster, also
  // works over ssh) and fall back to the PTY-process query.
  let cwd: string | undefined;
  if (leaf.session.cwd) {
    cwd = leaf.session.cwd;
  } else {
    try {
      const c = await getCwd(leaf.session.ptyId);
      if (c) cwd = c;
    } catch (_) { /* ignore */ }
  }

  // Build the split DOM structure FIRST so splitEl is in the document
  // by the time createLeaf attaches the new pane into it. This ensures
  // the new pane has real layout dimensions when xterm initializes —
  // otherwise restored scrollback (in splitLeaf) and even fresh shell
  // output land at xterm's default 80 cols.
  const splitEl = document.createElement("div");
  splitEl.className = `pane-container ${axis}`;
  splitEl.style.flex = "1";
  splitEl.style.minWidth = "0";
  splitEl.style.minHeight = "0";
  splitEl.style.display = "flex";
  splitEl.style.flexDirection = axis === "vertical" ? "row" : "column";

  const handle = document.createElement("div");
  handle.className = `split-handle ${axis}`;
  attachSplitHandleDrag(handle, axis);

  // Replace the leaf's element in the DOM with the split container.
  const parent = leaf.element.parentElement!;
  parent.replaceChild(splitEl, leaf.element);

  splitEl.appendChild(leaf.element);
  splitEl.appendChild(handle);

  // createLeaf appends the new pane to splitEl (which is now in the
  // DOM) before awaiting xterm setup.
  const newLeaf = await createLeaf({ parentEl: splitEl, cwd });

  const splitNode: SplitNode = {
    type: "split",
    axis,
    first: leaf,
    second: newLeaf,
    element: splitEl,
  };

  // Replace in tree.
  replaceInTree(leaf.paneId, splitNode);

  setActivePane(newLeaf.paneId);

  // Re-fit all terminals after layout change.
  requestAnimationFrame(() => fitAll(tree!));
}

/** Split a SPECIFIC leaf along an axis with an explicit cwd, returning
 *  the resulting leaf paneIds. Unlike splitActive, this:
 *   - Targets a leaf by id (not "the active one"), so the closed-tab
 *     replay can split a non-focused leaf during reconstruction.
 *   - Takes an explicit cwd (caller already knows it from the saved
 *     shape), so we skip the OSC-7 / PTY-query inheritance dance.
 *   - Returns { firstId, secondId } so recursive replay can walk into
 *     both new children.
 *
 * Returns undefined if `targetId` doesn't exist in the current tree —
 * defensive against a snapshot/tree mismatch. The caller logs a warn
 * and aborts that subtree.
 *
 * After the split: firstId === targetId (the original leaf is reused,
 * its paneId/session unchanged), secondId is a fresh leaf created with
 * `createLeaf(cwd)`. The active pane is NOT changed — the caller drives
 * focus, not us. */
export async function splitLeaf(
  targetId: number,
  axis: SplitAxis,
  cwd?: string,
  restoredScrollback?: string,
  restoredClaudeResume?: { uuid: string },
): Promise<{ firstId: number; secondId: number } | undefined> {
  if (!tree) return undefined;
  const leaf = findLeaf(tree, targetId);
  if (!leaf) return undefined;

  // Build split DOM first so splitEl is in-document before createLeaf
  // attaches the new pane. Mirrors splitActive — see comment there.
  const splitEl = document.createElement("div");
  splitEl.className = `pane-container ${axis}`;
  splitEl.style.flex = "1";
  splitEl.style.minWidth = "0";
  splitEl.style.minHeight = "0";
  splitEl.style.display = "flex";
  splitEl.style.flexDirection = axis === "vertical" ? "row" : "column";

  const handle = document.createElement("div");
  handle.className = `split-handle ${axis}`;
  attachSplitHandleDrag(handle, axis);

  const parent = leaf.element.parentElement!;
  parent.replaceChild(splitEl, leaf.element);
  splitEl.appendChild(leaf.element);
  splitEl.appendChild(handle);

  const newLeaf = await createLeaf({
    parentEl: splitEl,
    cwd,
    restoredScrollback,
    restoredClaudeResume,
  });

  const splitNode: SplitNode = {
    type: "split",
    axis,
    first: leaf,
    second: newLeaf,
    element: splitEl,
  };

  replaceInTree(leaf.paneId, splitNode);

  // Re-fit so newly-mounted xterm gets correct cols/rows. Same idiom as
  // splitActive — schedules into the next animation frame so layout has
  // a chance to settle first.
  requestAnimationFrame(() => fitAll(tree!));

  return { firstId: leaf.paneId, secondId: newLeaf.paneId };
}

/**
 * Close the active pane.
 *
 * Ordering is load-bearing: compute the DOM swap, perform it, THEN dispose
 * the terminal session. The inverse order (dispose-then-swap) was the
 * source of a user-reported regression: session.dispose() synchronously
 * detaches the .terminal-container as part of its cleanup, and if anything
 * after it threw (real term.dispose() / webgl teardown can on GPU context
 * loss) the outer .pane frame never got removed. The user saw "Cmd+W
 * closes only the terminal, not the pane". Swap-first makes the visible
 * close atomic from the user's POV; dispose runs last and its failure is
 * swallowed — a flaky teardown cannot strand the UI.
 */
export function closeActive(): void {
  if (!tree) return;
  if (tree.type === "leaf") return; // Don't close the last pane.

  const leaf = findLeaf(tree, activePaneId);
  if (!leaf) return;

  // Find parent split and sibling BEFORE mutating anything.
  const parentInfo = findParentSplit(tree, activePaneId);
  if (!parentInfo) return;

  const { parent: splitNode, sibling } = parentInfo;

  // Replace split node with sibling in DOM — this is the user-visible close.
  const grandparent = splitNode.element.parentElement!;
  grandparent.replaceChild(sibling.element, splitNode.element);

  // Reset the promoted sibling to fill its new parent. A resize drag pins the
  // FIRST child of a split to a fixed basis (`flex: 0 0 Npx`, see
  // split-handle-drag.ts); without this reset, closing the other pane would
  // leave that survivor stuck at its dragged size instead of going full-size.
  sibling.element.style.flex = "1";

  // Replace in tree.
  replaceSplitWithChild(splitNode, sibling);

  // Focus the first leaf in the sibling subtree.
  const firstLeaf = findFirstLeaf(sibling);
  if (firstLeaf) setActivePane(firstLeaf.paneId);

  // Dispose last, and swallow failures so a flaky xterm/webgl teardown
  // can't leave the UI half-closed.
  try {
    leaf.session.dispose();
  } catch (e) {
    console.warn("pane session dispose failed:", e);
  }
  import("./claude-session-map").then(({ removePane }) => removePane(leaf.paneId));

  requestAnimationFrame(() => fitAll(tree!));
}

/** Focus a neighbor pane in the given direction. */
export function focusDirection(axis: SplitAxis, forward: boolean): void {
  if (!tree) return;
  const allLeaves = collectLeaves(tree);
  if (allLeaves.length <= 1) return;

  const idx = allLeaves.findIndex((l) => l.paneId === activePaneId);
  if (idx === -1) return;

  // Simple: just cycle through leaves.
  const next = forward
    ? allLeaves[(idx + 1) % allLeaves.length]
    : allLeaves[(idx - 1 + allLeaves.length) % allLeaves.length];

  setActivePane(next.paneId);
}

export function getActiveSession(): TerminalSession | undefined {
  if (!tree) return undefined;
  const leaf = findLeaf(tree, activePaneId);
  return leaf?.session;
}

export function getActivePaneId(): number {
  return activePaneId;
}

export function getSessionByPaneId(id: number): TerminalSession | undefined {
  if (!tree) return undefined;
  const leaf = findLeaf(tree, id);
  return leaf?.session;
}

export function fitActivePane(): void {
  if (!tree) return;
  const leaf = findLeaf(tree, activePaneId);
  if (leaf) leaf.session.fit.fit();
}

export function fitAllPanes(): void {
  if (tree) fitAll(tree);
}

/** Dispose all panes (used when switching tabs). */
export function getTree(): PaneTree | null {
  return tree;
}

/**
 * Recursively dispose every terminal session in a subtree. Used by
 * closeTab() so closing a tab doesn't leak PTY processes and doesn't leave
 * xterm instances attached to detached DOM. Safe to call with null.
 */
export function disposeTree(node: PaneTree | null): void {
  if (!node) return;
  if (node.type === "leaf") {
    // Swallow per-session failures so one flaky teardown can't abort the
    // walk and leak the rest of the subtree's PTYs (same failure shape as
    // the closeActive() zombie-pane bug).
    try { node.session.dispose(); } catch (e) { console.warn("pane session dispose failed:", e); }
    import("./claude-session-map").then(({ removePane }) => removePane(node.paneId));
    return;
  }
  disposeTree(node.first);
  disposeTree(node.second);
}

export function setTree(newTree: PaneTree | null) {
  tree = newTree;
  if (tree) {
    const first = findFirstLeaf(tree);
    if (first) activePaneId = first.paneId;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function createLeaf(opts: {
  /** Where to attach the new .pane element BEFORE awaiting xterm setup.
   *  Required: scrollback replay needs the container to have real
   *  dimensions at write time, which only happens once the .pane is in
   *  the document and laid out — see createTerminalSession's leading
   *  fit.fit() and offsetWidth force-layout. */
  parentEl: HTMLElement;
  cwd?: string;
  restoredScrollback?: string;
  restoredClaudeResume?: { uuid: string };
}): Promise<LeafNode> {
  const paneId = nextPaneId++;
  const el = document.createElement("div");
  el.className = "pane";
  el.style.flex = "1";
  el.style.minWidth = "0";
  el.style.minHeight = "0";
  el.dataset.paneId = String(paneId);

  // Click to focus.
  el.addEventListener("mousedown", () => setActivePane(paneId));

  // Pane head strip (pid · cwd · branch). Placed above the terminal container
  // created by createTerminalSession; xterm sits below it and fills the rest.
  const head = document.createElement("div");
  head.className = "pane-head";
  head.dataset.paneId = String(paneId);
  head.innerHTML = `
    <span class="pid"></span>
    <span class="sep">·</span>
    <span class="cwd"></span>
  `;
  el.appendChild(head);

  // Attach to the DOM BEFORE creating the xterm session so the pane has
  // real dimensions when fit.fit() runs. Without this, restored
  // scrollback wraps at xterm's default 80 cols and stays wrapped after
  // the ResizeObserver later resizes the terminal — xterm doesn't reflow
  // already-rendered scrollback rows.
  opts.parentEl.appendChild(el);

  const session = await createTerminalSession(
    el,
    opts.cwd,
    opts.restoredScrollback,
    opts.restoredClaudeResume,
  );

  updatePaneHead(head, paneId, session.ptyId, session.cwd ?? opts?.cwd ?? null);

  // Refresh head when OSC 7 lands a new cwd. Poll lightly to avoid coupling
  // to the OSC 7 parser — cheap and bounded to the visible panes.
  let pollStopped = false;
  const poll = window.setInterval(async () => {
    if (pollStopped || !document.body.contains(head)) {
      clearInterval(poll);
      return;
    }
    updatePaneHead(head, paneId, session.ptyId, session.cwd ?? null);
    await refreshClaudeHudFor(el, session.ptyId, paneId);
  }, 2000);

  // Wrap session.dispose so closing the pane also stops the poll immediately.
  // Without this, the interval survives until the next tick's DOM check — and
  // any async work in-flight at disposal time keeps closures alive longer.
  const originalDispose = session.dispose;
  session.dispose = () => {
    pollStopped = true;
    clearInterval(poll);
    originalDispose();
  };

  return { type: "leaf", paneId, session, element: el };
}

function updatePaneHead(head: HTMLElement, paneId: number, ptyId: number, cwd: string | null): void {
  const pid = head.querySelector<HTMLElement>(".pid");
  const cwdEl = head.querySelector<HTMLElement>(".cwd");
  if (pid) pid.textContent = `[${paneId}·pty${ptyId}]`;
  if (cwdEl) {
    const home = (cwd ?? "~").replace(/^\/Users\/[^/]+/, "~");
    cwdEl.textContent = home;
  }
}

export function setActivePane(id: number) {
  activePaneId = id;
  paneBadge.delete(id);
  if (tree) {
    const leaf = findLeaf(tree, id);
    if (leaf) {
      const head = leaf.element.querySelector<HTMLElement>(":scope > .pane-head");
      if (head) applyPaneBadgeClass(head, null);
    }
  }
  if (!tree) return;

  // Update active styling on all leaves.
  const leaves = collectLeaves(tree);
  for (const leaf of leaves) {
    if (leaf.paneId === id) {
      leaf.element.classList.add("active");
      leaf.session.term.focus();
    } else {
      leaf.element.classList.remove("active");
    }
  }
}

export function paneCwdBasename(paneId: number): string | null {
  if (!tree) return null;
  const leaf = findLeaf(tree, paneId);
  if (!leaf) return null;
  const cwd = leaf.session?.cwd;
  if (!cwd) return null;
  const trimmed = cwd.replace(/\/$/, "");
  return trimmed.split("/").pop() ?? null;
}

function findLeaf(node: PaneTree, id: number): LeafNode | null {
  if (node.type === "leaf") return node.paneId === id ? node : null;
  return findLeaf(node.first, id) || findLeaf(node.second, id);
}

function findFirstLeaf(node: PaneTree): LeafNode | null {
  if (node.type === "leaf") return node;
  return findFirstLeaf(node.first);
}

function collectLeaves(node: PaneTree): LeafNode[] {
  if (node.type === "leaf") return [node];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

function replaceInTree(leafId: number, replacement: PaneTree): void {
  if (!tree) return;
  if (tree.type === "leaf" && tree.paneId === leafId) {
    tree = replacement;
    return;
  }
  replaceInNode(tree, leafId, replacement);
}

function replaceInNode(node: PaneTree, leafId: number, replacement: PaneTree): boolean {
  if (node.type === "leaf") return false;
  if (node.first.type === "leaf" && node.first.paneId === leafId) {
    node.first = replacement;
    return true;
  }
  if (node.second.type === "leaf" && node.second.paneId === leafId) {
    node.second = replacement;
    return true;
  }
  return replaceInNode(node.first, leafId, replacement) || replaceInNode(node.second, leafId, replacement);
}

function findParentSplit(node: PaneTree, leafId: number): { parent: SplitNode; sibling: PaneTree } | null {
  if (node.type === "leaf") return null;
  if (node.first.type === "leaf" && node.first.paneId === leafId) {
    return { parent: node, sibling: node.second };
  }
  if (node.second.type === "leaf" && node.second.paneId === leafId) {
    return { parent: node, sibling: node.first };
  }
  return findParentSplit(node.first, leafId) || findParentSplit(node.second, leafId);
}

function replaceSplitWithChild(splitNode: SplitNode, child: PaneTree): void {
  if (!tree) return;
  if (tree === splitNode) {
    tree = child;
    return;
  }
  replaceSplitInNode(tree, splitNode, child);
}

function replaceSplitInNode(node: PaneTree, target: SplitNode, replacement: PaneTree): boolean {
  if (node.type === "leaf") return false;
  if (node.first === target) { node.first = replacement; return true; }
  if (node.second === target) { node.second = replacement; return true; }
  return replaceSplitInNode(node.first, target, replacement) || replaceSplitInNode(node.second, target, replacement);
}

function fitAll(node: PaneTree): void {
  if (node.type === "leaf") {
    // Preserve the user's scroll position across resize. If they were pinned to
    // the bottom, re-pin after reflow — otherwise xterm's rewrap can leave the
    // viewport above the prompt, which reads as "the terminal scrolled up".
    const { term, fit } = node.session;
    const buf = term.buffer.active;
    const wasAtBottom = buf.viewportY >= buf.baseY;
    fit.fit();
    if (wasAtBottom) term.scrollToBottom();
  } else {
    fitAll(node.first);
    fitAll(node.second);
  }
}

async function maybeAutoInstall(): Promise<void> {
  if (installAttempted) return;
  installAttempted = true;

  const { getPrefs, setPref } = await import("./ui-prefs");
  const prefs = getPrefs();
  if (prefs.claudeRateLimitsEnabled !== undefined) return; // already decided

  const { installRateLimits } = await import("./claude-rate-limits");
  const { showToast } = await import("./toast");

  try {
    const outcome = await installRateLimits(false);
    if (outcome.kind === "Installed" || outcome.kind === "NoOp") {
      setPref("claudeRateLimitsEnabled", true);
      showToast({
        kind: "success",
        message: "Kimbo enabled rate-limit display in Claude.",
        detail: "Disable in Settings → Claude Code → HUD.",
      });
    } else if (outcome.kind === "Pending") {
      showToast({
        kind: "info",
        message: "Enable rate-limit display in Claude?",
        detail: `Your current statusLine (${outcome.existing}) would be replaced. Toggle in Settings → Claude Code → HUD if you'd like to enable it.`,
      });
      setPref("claudeRateLimitsEnabled", "dismissed");
    }
  } catch (e) {
    console.warn("auto-install failed:", e);
    showToast({
      kind: "error",
      message: "Couldn't enable rate-limit display",
      detail: String(e),
    });
  }
}

let notifyAutoInstallAttempted = false;

async function maybeAutoInstallNotifications(): Promise<void> {
  if (notifyAutoInstallAttempted) return;
  notifyAutoInstallAttempted = true;

  const { getPrefs, setPref } = await import("./ui-prefs");
  const prefs = getPrefs();

  // Skip if either pref has already been decided (true / false / "dismissed").
  if (prefs.notifyOnStop !== undefined || prefs.notifyOnPermission !== undefined) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const { showToast } = await import("./toast");

  try {
    await invoke("claude_notifications_install");
    setPref("notifyOnStop", true);
    setPref("notifyOnPermission", true);
    showToast({
      kind: "success",
      message: "Kimbo enabled Claude notifications.",
      detail: "Disable in Settings → Claude Code → Notifications.",
    });
    const { ensureNotificationPermission } = await import("./claude-notifications");
    void ensureNotificationPermission();
  } catch (e) {
    // Transient failures (FS errors, permission denied, etc.) — leave the
    // prefs undefined so the next claude-detect retries. The Settings UI
    // status row exposes the current install state independently.
    // Note: "dismissed" is NOT set here — it is only reachable via explicit
    // user action in the Settings panel (if that flow is added later).
    notifyAutoInstallAttempted = false;
    showToast({
      kind: "error",
      message: "Couldn't enable Claude notifications",
      detail: String(e),
    });
  }
}

/** True when `node` or any ancestor is hidden via `display:none` — which is
 * exactly how an inactive tab's container is hidden (tabs.ts). Reads inline
 * styles so it also works under jsdom (which performs no layout). */
function isInHiddenTab(node: HTMLElement | null): boolean {
  for (let cur: HTMLElement | null = node; cur; cur = cur.parentElement) {
    if (cur.style && cur.style.display === "none") return true;
  }
  return false;
}

async function refreshClaudeHudFor(paneEl: HTMLElement, ptyId: number, paneId: number): Promise<void> {
  const { renderClaudeHud } = await import("./claude-hud");
  const { getPrefs } = await import("./ui-prefs");
  const prefs = getPrefs();

  // The status probe shells out `ps` over the whole process table on the Rust
  // side, so skip it entirely when the HUD is disabled or the pane lives in a
  // hidden (background) tab — otherwise every pane in every tab would scan the
  // process table every poll tick regardless of settings or visibility.
  //
  // A hidden pane skips the probe but KEEPS its strip. Removing it would shrink
  // the pane's terminal by the strip's 22px, and re-inserting it on reselect
  // would shrink it back — each change refits xterm, changes the row count and
  // resizes the PTY, so the terminal jumps every time you switch tabs.
  const action = chooseHudAction({
    hudEnabled: prefs.claudeHudEnabled,
    hidden: isInHiddenTab(paneEl),
  });
  if (action === "skip") return;
  if (action === "remove") {
    const stale = paneEl.querySelector(":scope > .claude-hud");
    if (stale) stale.remove();
    return;
  }

  const { claudeStatus } = await import("./claude-status");
  const { getAccountInfo } = await import("./claude-account");
  const { getRateLimits } = await import("./claude-rate-limits");
  const { setSessionPane } = await import("./claude-session-map");

  const [status, account, rateLimits] = await Promise.all([
    claudeStatus(ptyId),
    getAccountInfo(),
    getRateLimits(),
  ]);

  if (status) {
    setSessionPane(status.session_id, paneId);
    void maybeAutoInstall();
    void maybeAutoInstallNotifications();
  }

  const newHud = renderClaudeHud(status, account, rateLimits, {
    hudEnabled: prefs.claudeHudEnabled,
    extendedFields: prefs.claudeHudExtended,
    showPlan: prefs.claudeHudShowPlan,
  });

  // Remove any existing strip.
  const existing = paneEl.querySelector(":scope > .claude-hud");
  if (existing) existing.remove();
  // Insert the new strip just after .pane-head, before the terminal container.
  if (newHud) {
    const head = paneEl.querySelector(":scope > .pane-head");
    if (head && head.parentNode === paneEl) {
      paneEl.insertBefore(newHud, head.nextSibling);
    } else {
      paneEl.prepend(newHud);
    }
  }
}
