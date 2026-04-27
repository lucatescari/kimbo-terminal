// In-memory LIFO stack of recently closed tabs (depth 10). Powers ⌘⇧T:
// each closeTab pushes a serializable "shape" of the pane tree + the tab's
// display state; reopenLastClosedTab pops and replays it.
//
// Stack is module-local and never serialized — closed-tab history is
// session-bounded by design. Persisting it would conflict with the
// existing session-restore (see session-state.ts) which already brings
// back tabs that were OPEN at quit time. Layering closed-tab history
// over that would create two competing recovery mechanisms.

/** A serializable leaf — just a cwd. No DOM, no TerminalSession. */
export interface ClosedLeaf {
  type: "leaf";
  cwd: string | null;
}

/** A serializable split — axis + two children. Sizes are NOT preserved
 *  (replay always uses the default 50/50). */
export interface ClosedSplit {
  type: "split";
  axis: "vertical" | "horizontal";
  first: ClosedTabShape;
  second: ClosedTabShape;
}

export type ClosedTabShape = ClosedLeaf | ClosedSplit;

export interface ClosedTabEntry {
  shape: ClosedTabShape;
  /** Display name at close time (cwd-derived). */
  name: string;
  /** Shell-provided OSC 0/2 title, if any. Restored on reopen so a
   *  shell-renamed tab keeps its label. */
  titleOverride?: string;
  /** Position in the tab bar at close time. Reopen tries to land here;
   *  falls back to the end if the index is now out of range. */
  originalIndex: number;
}

const MAX_DEPTH = 10;
const stack: ClosedTabEntry[] = [];

/** Push to the top of the stack. Drops the OLDEST entry (FIFO eviction)
 *  when the depth cap is reached so the most recent N closes are always
 *  available. */
export function pushClosedTab(entry: ClosedTabEntry): void {
  stack.push(entry);
  if (stack.length > MAX_DEPTH) stack.shift();
}

/** Pop the most recently closed tab. Returns undefined when empty. */
export function popClosedTab(): ClosedTabEntry | undefined {
  return stack.pop();
}

export function closedTabsCount(): number {
  return stack.length;
}

/** Test-only — let each test start with a clean module. */
export function clearClosedTabs(): void {
  stack.length = 0;
}

// ---------------------------------------------------------------------------
// Shape conversion helpers
// ---------------------------------------------------------------------------

/** Loose structural type for the live PaneTree. We don't import the real
 *  type from panes.ts because (a) those types are file-local, and (b) we
 *  only need the fields below. The runtime check on `node.type` is what
 *  actually narrows. */
type LivePaneNode =
  | { type: "leaf"; session: { cwd: string | null } }
  | { type: "split"; axis: "vertical" | "horizontal"; first: LivePaneNode; second: LivePaneNode };

/** Convert a live PaneTree into a serializable ClosedTabShape, dropping
 *  paneId/element/session refs. The cwd we capture is the shell's last
 *  OSC 7 report (session.cwd) — we deliberately don't query the PTY for
 *  a fresh value at close time because a newly idle prompt might not
 *  have re-emitted OSC 7 yet, and reopening at a stale-by-one-cd cwd is
 *  much better than reopening at a null cwd that falls back to $HOME. */
export function shapeFromTree(node: LivePaneNode): ClosedTabShape {
  if (node.type === "leaf") {
    return { type: "leaf", cwd: node.session.cwd ?? null };
  }
  return {
    type: "split",
    axis: node.axis,
    first: shapeFromTree(node.first),
    second: shapeFromTree(node.second),
  };
}

/** First-leaf cwd, walking always left through splits. Used to seed the
 *  reopen with a useful cwd for the initial createTab call before
 *  replay reconstructs the rest of the layout. */
export function firstLeafCwd(shape: ClosedTabShape): string | null {
  return shape.type === "leaf" ? shape.cwd : firstLeafCwd(shape.first);
}
