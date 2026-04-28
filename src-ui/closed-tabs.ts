// In-memory LIFO stack of recently closed tabs (depth 10). Powers ⌘⇧T:
// each closeTab pushes a serializable "shape" of the pane tree + the tab's
// display state; reopenLastClosedTab pops and replays it.
//
// Stack is module-local and never serialized — closed-tab history is
// session-bounded by design. Persisting it would conflict with the
// existing session-restore (see session-state.ts) which already brings
// back tabs that were OPEN at quit time. Layering closed-tab history
// over that would create two competing recovery mechanisms.

import { probeClaudeSession } from "./claude-session-probe";

/** A serializable leaf — cwd plus optional captured scrollback. The
 *  scrollback is replayed into the reopened pane to restore on-screen
 *  history (the "I closed Claude Code by accident" recovery path). */
export interface ClosedLeaf {
  type: "leaf";
  cwd: string | null;
  /** ANSI-encoded scrollback at close time. Replayed verbatim into the
   *  reopened leaf's terminal before the fresh shell's prompt arrives.
   *  Optional so empty panes (or future code paths that skip capture)
   *  reopen blank without a separator. */
  scrollback?: string;
  /** Recovered Claude Code session id, if a `claude` descendant was
   *  running in this leaf at close time. Surfaced as a "resume:" line
   *  beneath the restored separator on reopen. Optional and silently
   *  omitted on miss — see claude-session-probe.ts. */
  claudeResume?: { uuid: string };
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
  | {
      type: "leaf";
      session: {
        cwd: string | null;
        ptyId: number;
        serialize: () => string;
      };
    }
  | {
      type: "split";
      axis: "vertical" | "horizontal";
      first: LivePaneNode;
      second: LivePaneNode;
    };

/** Convert a live PaneTree into a serializable ClosedTabShape, dropping
 *  paneId/element/session refs. The cwd we capture is the shell's last
 *  OSC 7 report (session.cwd) — we deliberately don't query the PTY for
 *  a fresh value at close time because a newly idle prompt might not
 *  have re-emitted OSC 7 yet, and reopening at a stale-by-one-cd cwd is
 *  much better than reopening at a null cwd that falls back to $HOME.
 *
 *  Per-leaf, we ALSO probe for a running Claude Code descendant (see
 *  claude-session-probe.ts) and stash its session UUID. Probes run in
 *  parallel across all leaves; each call is internally budgeted so the
 *  overall close-flow latency is capped at ~100ms regardless of tree
 *  size.
 */
export async function shapeFromTreeAsync(
  node: LivePaneNode,
): Promise<ClosedTabShape> {
  if (node.type === "leaf") {
    let scrollback: string | undefined;
    try {
      const captured = node.session.serialize();
      scrollback = captured.length > 0 ? captured : undefined;
    } catch (e) {
      console.warn(
        "shapeFromTreeAsync: serialize failed, leaf will reopen blank:",
        e,
      );
    }
    const claudeResume = (await probeClaudeSession(node.session.ptyId)) ?? undefined;
    const leaf: ClosedLeaf = {
      type: "leaf",
      cwd: node.session.cwd ?? null,
      scrollback,
    };
    if (claudeResume) leaf.claudeResume = claudeResume;
    return leaf;
  }
  const [first, second] = await Promise.all([
    shapeFromTreeAsync(node.first),
    shapeFromTreeAsync(node.second),
  ]);
  return { type: "split", axis: node.axis, first, second };
}

/** First-leaf cwd, walking always left through splits. Used to seed the
 *  reopen with a useful cwd for the initial createTab call before
 *  replay reconstructs the rest of the layout. */
export function firstLeafCwd(shape: ClosedTabShape): string | null {
  return shape.type === "leaf" ? shape.cwd : firstLeafCwd(shape.first);
}

/** First-leaf scrollback, walking always-left through splits. Mirrors
 *  firstLeafCwd's purpose: seeds the root pane created by createTab
 *  before replayShape recurses into the rest of the layout. Returns
 *  undefined if the leftmost leaf has no captured scrollback (empty
 *  pane at close time). */
export function firstLeafScrollback(shape: ClosedTabShape): string | undefined {
  return shape.type === "leaf" ? shape.scrollback : firstLeafScrollback(shape.first);
}

/** First-leaf claudeResume, walking always-left through splits. Mirrors
 *  firstLeafCwd / firstLeafScrollback: seeds the root pane created by
 *  createTab before replayShape recurses into the rest of the layout.
 *  Returns undefined if the leftmost leaf had no claude descendant at
 *  close time. */
export function firstLeafClaudeResume(
  shape: ClosedTabShape,
): { uuid: string } | undefined {
  return shape.type === "leaf"
    ? shape.claudeResume
    : firstLeafClaudeResume(shape.first);
}

/** Visual separator written between restored scrollback and the fresh
 *  shell's first prompt. Gray (256-color 245), ASCII-art horizontal
 *  rule. The message tells the user what they're looking at without
 *  using a full banner. \r\n on each side forces fresh lines so the
 *  separator never appends to a partial line in the captured scrollback.
 *
 *  Plain FG color, no DIM (`\x1b[2m`) and no italic (`\x1b[3m`): both
 *  attributes set bits in xterm.js's BG word, which makes the WebGL
 *  renderer paint an opaque rectangle behind the cell — visible as a
 *  solid black bar on a translucent terminal. FG-only sidesteps the
 *  renderer path entirely. */
export function restoredSeparator(): string {
  return "\r\n\x1b[38;5;245m─── reopened from closed tab ───\x1b[0m\r\n";
}
