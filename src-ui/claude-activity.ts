// Turns Claude Code's own session state into the four-value activity a tab
// can render. Pure: no DOM, no Tauri, no clock of its own. `now` is passed in
// so staleness is testable.
//
// The reason this file exists rather than the Rust side deciding: the rules
// below are where the judgement calls live (what counts as stale, which
// status values are trustworthy), and they are much cheaper to test here.

/** Raw per-PTY state from the `claude_tab_states` command. snake_case matches
 *  the serde-serialized Rust struct directly, as `ClaudeStatus` already does. */
export interface BackgroundJob {
  session_id: string;
  tempo: string | null;
  in_flight_tasks: number;
  updated_at: string | null;
  detail: string | null;
}

export interface PtyClaudeState {
  pty_id: number;
  session_id: string;
  status: string | null;
  waiting_for: string | null;
  status_updated_at_ms: number | null;
  background: BackgroundJob[];
}

export type Activity = "none" | "idle" | "busy" | "waiting";

export interface PaneActivity {
  activity: Activity;
  /** `waitingFor`, or a background job's `detail`. Tooltip copy only. */
  reason: string | null;
}

/** How long after its last write a background job stops counting as live.
 *  Jobs on disk keep a live-looking `tempo` indefinitely after the daemon
 *  behind them is gone, so freshness is the only thing separating "still
 *  working" from "was working in June". */
export const BACKGROUND_STALE_MS = 10 * 60 * 1000;

const NONE: PaneActivity = { activity: "none", reason: null };

/** Severity order. `waiting` outranks `busy` because it is the only state
 *  that needs the user to do something. */
const RANK: Record<Activity, number> = { none: 0, idle: 1, busy: 2, waiting: 3 };

/** Whether a background job counts as ongoing work.
 *
 *  Three independent gates, each closing a specific false positive:
 *  an explicit tempo (absent means "no opinion", not "working"), freshness
 *  (stale files keep a live tempo forever), and first-sighting during this
 *  pane's life (otherwise a fresh launch lights up tabs from old jobs). */
export function isJobLive(
  job: BackgroundJob,
  firstSeen: ReadonlySet<string>,
  now: number,
): boolean {
  if (job.tempo !== "active" && job.tempo !== "blocked") return false;
  if (!firstSeen.has(job.session_id)) return false;
  if (job.updated_at === null) return false;
  const updated = Date.parse(job.updated_at);
  if (Number.isNaN(updated)) return false;
  return now - updated <= BACKGROUND_STALE_MS;
}

export function paneActivity(
  state: PtyClaudeState | null,
  firstSeen: ReadonlySet<string>,
  now: number,
): PaneActivity {
  if (state === null) return NONE;

  // Both sources feed one severity fold: `waiting` from either beats `busy`
  // from either. A blocked fork needs the user even while the main session is
  // still working, and nothing else in the UI would tell them.
  const live = state.background.filter((j) => isJobLive(j, firstSeen, now));

  if (state.status === "waiting") {
    return { activity: "waiting", reason: state.waiting_for };
  }
  const blocked = live.find((j) => j.tempo === "blocked");
  if (blocked) return { activity: "waiting", reason: blocked.detail };

  // `busy` is `isLoading || delegatedActive` in Claude Code, so it already
  // covers a turn parked in a Task call while subagents work — those run
  // in-process and have no pid to find.
  if (state.status === "busy") {
    return { activity: "busy", reason: null };
  }
  const active = live.find((j) => j.tempo === "active");
  if (active) return { activity: "busy", reason: active.detail };

  return { activity: "idle", reason: null };
}

/** Fold a tab's panes into the one state worth showing on the tab. */
export function tabActivity(panes: readonly PaneActivity[]): PaneActivity {
  let best: PaneActivity = NONE;
  for (const p of panes) {
    if (RANK[p.activity] > RANK[best.activity]) best = p;
  }
  return best;
}
