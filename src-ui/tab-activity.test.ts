// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runTick,
  resetSeenJobsForTesting,
  startTabActivityPoll,
  stopTabActivityPoll,
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  type TickDeps,
} from "./tab-activity";
import type { PtyClaudeState } from "./claude-activity";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");

function deps(over: Partial<TickDeps> = {}): TickDeps & { painted: [number, string][] } {
  const painted: [number, string][] = [];
  return {
    painted,
    ptys: () => [{ tabId: 1, ptyId: 10 }],
    probe: async () => [],
    paint: (tabId, a) => painted.push([tabId, a.activity]),
    now: () => NOW,
    ...over,
  };
}

function state(over: Partial<PtyClaudeState> = {}): PtyClaudeState {
  return {
    pty_id: 10,
    session_id: "s-1",
    status: "busy",
    waiting_for: null,
    status_updated_at_ms: NOW,
    background: [],
    ...over,
  };
}

describe("tab activity poll", () => {
  beforeEach(() => {
    resetSeenJobsForTesting();
  });

  it("paints none for a tab whose ptys returned no claude state", async () => {
    const d = deps();
    await runTick(d);
    expect(d.painted).toEqual([[1, "none"]]);
  });

  it("paints the aggregated state for a tab", async () => {
    const d = deps({ probe: async () => [state({ status: "busy" })] });
    await runTick(d);
    expect(d.painted).toEqual([[1, "busy"]]);
  });

  it("folds several panes in one tab by severity", async () => {
    const d = deps({
      ptys: () => [
        { tabId: 1, ptyId: 10 },
        { tabId: 1, ptyId: 11 },
      ],
      probe: async () => [
        state({ pty_id: 10, status: "busy" }),
        state({ pty_id: 11, status: "waiting", waiting_for: "needs permission" }),
      ],
    });
    await runTick(d);
    expect(d.painted).toEqual([[1, "waiting"]]);
  });

  it("polls fast while a claude session exists and slowly when none does", async () => {
    const busy = deps({ probe: async () => [state()] });
    expect(await runTick(busy)).toBe(ACTIVE_POLL_MS);

    const empty = deps();
    expect(await runTick(empty)).toBe(IDLE_POLL_MS);
  });

  it("holds the previous state rather than flickering to none when the probe rejects", async () => {
    const d = deps({ probe: async () => { throw new Error("command failed"); } });
    await runTick(d);
    expect(d.painted).toEqual([]);
  });

  it("keeps polling on the idle cadence after a probe failure", async () => {
    const d = deps({ probe: async () => { throw new Error("boom"); } });
    expect(await runTick(d)).toBe(IDLE_POLL_MS);
  });

  it("skips the probe entirely when there are no ptys", async () => {
    const probe = vi.fn(async () => []);
    const d = deps({ ptys: () => [], probe });
    expect(await runTick(d)).toBe(IDLE_POLL_MS);
    expect(probe).not.toHaveBeenCalled();
  });

  it("only counts a background job it first saw on a previous tick", async () => {
    // First sighting must not light the tab up, or launching Kimbo with old
    // jobs on disk would paint every tab busy at once.
    const bg = {
      session_id: "job-1",
      tempo: "active",
      in_flight_tasks: 0,
      updated_at: new Date(NOW - 1000).toISOString(),
      detail: null,
    };
    const d = deps({
      probe: async () => [state({ status: "idle", background: [bg] })],
    });
    await runTick(d);
    expect(d.painted).toEqual([[1, "idle"]]);

    d.painted.length = 0;
    await runTick(d);
    expect(d.painted).toEqual([[1, "busy"]]);
  });
});

describe("poll lifecycle", () => {
  afterEach(() => {
    stopTabActivityPoll();
  });

  it("does not leave a second loop running when stopped and restarted mid-tick", async () => {
    // The stale loop must not resurrect itself just because a restart set
    // `running` back to true while its tick was still in flight. The bug
    // this guards is only visible on the *next* scheduled tick (the stale
    // loop resuming from its in-flight probe does not itself misbehave; it
    // is the setTimeout it then queues that duplicates work) so this test
    // uses fake timers to advance past that scheduling point rather than
    // just inspecting call counts immediately after the restart.
    vi.useFakeTimers();
    try {
      let release!: (v: PtyClaudeState[]) => void;
      const inFlight = new Promise<PtyClaudeState[]>((r) => { release = r; });

      let probeCalls = 0;
      const slow: TickDeps = {
        ...deps(),
        probe: () => { probeCalls++; return inFlight; },
      };

      startTabActivityPoll(slow);        // tick 1 begins, parks on `inFlight`
      stopTabActivityPoll();             // stopped while it is parked
      startTabActivityPoll(slow);        // restarted before it resolves
      expect(probeCalls).toBe(2);        // each start's loop made its first probe

      release([]);                       // let both in-flight ticks resolve
      // Flush the microtask chain from the resolution (runTick's await, then
      // the loop's await) before any timer has a chance to fire.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const callsBeforeNextTick = probeCalls;
      // Let whatever got scheduled for the next tick actually run.
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);

      // Only the loop we still own may have probed again. A resurrected
      // stale loop would have queued its own timer too and doubled this.
      expect(probeCalls).toBe(callsBeforeNextTick + 1);
    } finally {
      stopTabActivityPoll();
      vi.useRealTimers();
    }
  });
});
