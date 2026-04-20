import { createTerminalSession, TerminalSession } from "./terminal";
import { getCwd } from "./pty";

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initPanes(terminalArea: HTMLElement) {
  rootEl = terminalArea;
}

/** Create the initial pane (called once at startup). */
export async function createRootPane(cwd?: string): Promise<LeafNode> {
  const node = await createLeaf(cwd);
  tree = node;
  rootEl.appendChild(node.element);
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

  const newLeaf = await createLeaf(cwd);

  // Build split node.
  const splitEl = document.createElement("div");
  splitEl.className = `pane-container ${axis}`;
  splitEl.style.flex = "1";
  splitEl.style.minWidth = "0";
  splitEl.style.minHeight = "0";
  splitEl.style.display = "flex";
  splitEl.style.flexDirection = axis === "vertical" ? "row" : "column";

  const handle = document.createElement("div");
  handle.className = `split-handle ${axis}`;

  // Replace the leaf's element in the DOM with the split container.
  const parent = leaf.element.parentElement!;
  parent.replaceChild(splitEl, leaf.element);

  splitEl.appendChild(leaf.element);
  splitEl.appendChild(handle);
  splitEl.appendChild(newLeaf.element);

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

/** Close the active pane. */
export function closeActive(): void {
  if (!tree) return;
  if (tree.type === "leaf") return; // Don't close the last pane.

  const leaf = findLeaf(tree, activePaneId);
  if (!leaf) return;

  leaf.session.dispose();

  // Find parent split and sibling.
  const parentInfo = findParentSplit(tree, activePaneId);
  if (!parentInfo) return;

  const { parent: splitNode, sibling } = parentInfo;

  // Replace split node with sibling in DOM.
  const grandparent = splitNode.element.parentElement!;
  grandparent.replaceChild(sibling.element, splitNode.element);

  // Replace in tree.
  replaceSplitWithChild(splitNode, sibling);

  // Focus the first leaf in the sibling subtree.
  const firstLeaf = findFirstLeaf(sibling);
  if (firstLeaf) setActivePane(firstLeaf.paneId);

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

/**
 * Hit-test the panes at the given client (CSS-pixel) coordinates. Returns the
 * paneId of the innermost `.pane` element under the point, or `null` if the
 * point doesn't land on a pane (e.g. tab bar, split handle, overlay).
 */
export function findPaneIdAtPoint(clientX: number, clientY: number): number | null {
  const hit = document.elementFromPoint(clientX, clientY);
  let cur: Element | null = hit;
  while (cur) {
    if (cur instanceof HTMLElement && cur.classList.contains("pane")) {
      const raw = cur.dataset.paneId;
      if (raw != null) {
        const id = Number(raw);
        if (!Number.isNaN(id)) return id;
      }
    }
    cur = cur.parentElement;
  }
  return null;
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
    node.session.dispose();
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

async function createLeaf(cwd?: string): Promise<LeafNode> {
  const paneId = nextPaneId++;
  const el = document.createElement("div");
  el.className = "pane";
  el.style.flex = "1";
  el.style.minWidth = "0";
  el.style.minHeight = "0";
  el.style.display = "flex";
  el.style.position = "relative";
  el.dataset.paneId = String(paneId);

  // Click to focus.
  el.addEventListener("mousedown", () => setActivePane(paneId));

  const session = await createTerminalSession(el, cwd);

  return { type: "leaf", paneId, session, element: el };
}

export function setActivePane(id: number) {
  activePaneId = id;
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
