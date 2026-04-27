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
