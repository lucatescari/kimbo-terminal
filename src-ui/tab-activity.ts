// Drives the per-tab Claude activity dots.
//
// This owns its own interval rather than riding refreshClaudeHudFor, which
// returns early both for panes in hidden tabs and when the HUD preference is
// off (see chooseHudAction). Background tabs are exactly the ones an activity
// dot is for, so sharing that gating would leave the feature asleep in the
// only case it exists for. It is also not the HUD, and should not be silently
// switched off by the HUD's setting.
//
// Cost: one `ps` snapshot plus two small readdirs per tick for every pane,
// versus one `ps` per visible pane per tick today. It is cheaper than what it
// sits beside.

import { allTabPtys, setTabActivity } from "./tabs";
import {
  paneActivity,
  tabActivity,
  type PaneActivity,
  type PtyClaudeState,
} from "./claude-activity";

export const ACTIVE_POLL_MS = 2000;
/** Cadence when no pane is running claude. Not zero: a `claude` launched in
 *  any pane has to be noticed without an external trigger, and there is no
 *  reliable event for it. */
export const IDLE_POLL_MS = 10_000;

export interface TickDeps {
  probe(ids: number[]): Promise<PtyClaudeState[]>;
  ptys(): { tabId: number; ptyId: number }[];
  paint(tabId: number, activity: PaneActivity): void;
  now(): number;
}

/** Background job ids seen on a previous tick. A job is only allowed to make
 *  a tab look busy once it has been observed twice, which is what stops a
 *  fresh launch from lighting up every tab from months of jobs on disk. */
const seenJobs = new Set<string>();

/** Drop every remembered job sighting. Tests only: the module-level set would
 *  otherwise leak between cases and make the suite order-dependent. */
export function resetSeenJobsForTesting(): void {
  seenJobs.clear();
}

/** Run one tick against injected deps. Returns the delay before the next one,
 *  so the cadence is testable without fake timers. The seam is `TickDeps`,
 *  not this function: it is what `startTabActivityPoll` calls in production
 *  too, just with real deps wired in below. */
export async function runTick(deps: TickDeps): Promise<number> {
  const refs = deps.ptys();
  if (refs.length === 0) {
    pruneSeenJobs([]);
    return IDLE_POLL_MS;
  }

  let states: PtyClaudeState[];
  try {
    states = await deps.probe(refs.map((r) => r.ptyId));
  } catch (e) {
    // Hold whatever the dots already show. Painting `none` here would make a
    // transient command failure look like every claude session vanishing.
    console.warn("tab activity probe failed:", e);
    return IDLE_POLL_MS;
  }

  const byPty = new Map(states.map((s) => [s.pty_id, s]));
  const now = deps.now();

  // Snapshot the previous sighting set before recording this tick's, so a job
  // seen for the first time right now does not immediately count as live.
  const previouslySeen = new Set(seenJobs);
  const currentJobIds: string[] = [];
  for (const s of states) {
    for (const j of s.background) currentJobIds.push(j.session_id);
  }

  const byTab = new Map<number, PaneActivity[]>();
  for (const ref of refs) {
    const activity = paneActivity(byPty.get(ref.ptyId) ?? null, previouslySeen, now);
    const list = byTab.get(ref.tabId);
    if (list) list.push(activity);
    else byTab.set(ref.tabId, [activity]);
  }
  for (const [tabId, panes] of byTab) {
    deps.paint(tabId, tabActivity(panes));
  }

  pruneSeenJobs(currentJobIds);
  return states.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

/** Record this tick's job ids and forget any that are gone, so the set cannot
 *  grow across a long session. */
function pruneSeenJobs(currentIds: readonly string[]): void {
  const current = new Set(currentIds);
  for (const id of seenJobs) {
    if (!current.has(id)) seenJobs.delete(id);
  }
  for (const id of current) seenJobs.add(id);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** Bumped by every start and every stop. A loop captures its generation and
 *  refuses to schedule once it no longer matches, so a tick still in flight
 *  when the poll is stopped cannot resurrect itself if the poll is started
 *  again before that tick resolves. A bare boolean cannot express this: the
 *  restart would set it back to true and the stale loop would sail past it. */
let generation = 0;

async function realProbe(ids: number[]): Promise<PtyClaudeState[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<PtyClaudeState[] | null>("claude_tab_states", { ids });
  return result ?? [];
}

const realDeps: TickDeps = {
  probe: realProbe,
  ptys: allTabPtys,
  paint: setTabActivity,
  now: () => Date.now(),
};

/** Start polling. Idempotent. Self-scheduling rather than setInterval so a
 *  slow tick cannot overlap the next one. `deps` defaults to the real Tauri-
 *  backed dependencies; it is only overridable so tests can control the
 *  timing of a tick without touching `main.ts`. */
export function startTabActivityPoll(deps: TickDeps = realDeps): void {
  if (running) return;
  running = true;
  const myGeneration = ++generation;
  const loop = async () => {
    if (!running || generation !== myGeneration) return;
    let delay = IDLE_POLL_MS;
    try {
      delay = await runTick(deps);
    } catch (e) {
      console.warn("tab activity tick failed:", e);
    }
    if (!running || generation !== myGeneration) return;
    timer = setTimeout(loop, delay);
  };
  void loop();
}

export function stopTabActivityPoll(): void {
  running = false;
  generation++;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
