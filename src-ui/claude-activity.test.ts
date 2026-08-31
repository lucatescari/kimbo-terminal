// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  paneActivity,
  tabActivity,
  isJobLive,
  BACKGROUND_STALE_MS,
  type PtyClaudeState,
  type BackgroundJob,
} from "./claude-activity";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const FRESH = new Date(NOW - 1000).toISOString();
const STALE = new Date(NOW - BACKGROUND_STALE_MS - 1000).toISOString();

function state(over: Partial<PtyClaudeState> = {}): PtyClaudeState {
  return {
    pty_id: 1,
    session_id: "parent-a",
    status: "idle",
    waiting_for: null,
    status_updated_at_ms: NOW,
    background: [],
    ...over,
  };
}

function job(over: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    session_id: "job-1",
    tempo: "active",
    in_flight_tasks: 0,
    updated_at: FRESH,
    detail: null,
    ...over,
  };
}

const seen = (...ids: string[]) => new Set(ids);

describe("paneActivity: interactive status", () => {
  it("reports none when there is no claude in the pane", () => {
    expect(paneActivity(null, seen(), NOW)).toEqual({ activity: "none", reason: null });
  });

  it("reports busy for status busy", () => {
    expect(paneActivity(state({ status: "busy" }), seen(), NOW).activity).toBe("busy");
  });

  it("reports waiting for status waiting, carrying the reason", () => {
    expect(
      paneActivity(state({ status: "waiting", waiting_for: "input needed" }), seen(), NOW),
    ).toEqual({ activity: "waiting", reason: "input needed" });
  });

  it("reports idle for status idle", () => {
    expect(paneActivity(state({ status: "idle" }), seen(), NOW).activity).toBe("idle");
  });

  it("treats the shell status as idle, not busy", () => {
    // Observed on disk but not produced by the status function we read. A
    // missing indicator beats a tab that pulses forever.
    expect(paneActivity(state({ status: "shell" }), seen(), NOW).activity).toBe("idle");
  });

  it("treats an unknown future status as idle, not busy", () => {
    expect(paneActivity(state({ status: "compacting" }), seen(), NOW).activity).toBe("idle");
    expect(paneActivity(state({ status: null }), seen(), NOW).activity).toBe("idle");
  });
});

describe("isJobLive", () => {
  it("accepts a fresh, first-seen job with an explicit tempo", () => {
    expect(isJobLive(job(), seen("job-1"), NOW)).toBe(true);
    expect(isJobLive(job({ tempo: "blocked" }), seen("job-1"), NOW)).toBe(true);
  });

  it("rejects a job Kimbo did not first see during this pane's life", () => {
    // Otherwise launching Kimbo with months of jobs on disk lights up tabs.
    expect(isJobLive(job(), seen(), NOW)).toBe(false);
  });

  it("rejects a stale job even when its tempo still says active", () => {
    // The fixtures on disk include jobs last touched months ago still
    // reporting a live-looking tempo.
    expect(isJobLive(job({ updated_at: STALE }), seen("job-1"), NOW)).toBe(false);
    expect(isJobLive(job({ updated_at: null }), seen("job-1"), NOW)).toBe(false);
    expect(isJobLive(job({ updated_at: "not a date" }), seen("job-1"), NOW)).toBe(false);
  });

  it("rejects a job whose tempo is idle, absent or unrecognized", () => {
    expect(isJobLive(job({ tempo: "idle" }), seen("job-1"), NOW)).toBe(false);
    expect(isJobLive(job({ tempo: null }), seen("job-1"), NOW)).toBe(false);
    expect(isJobLive(job({ tempo: "draining" }), seen("job-1"), NOW)).toBe(false);
  });
});

describe("paneActivity: background jobs", () => {
  it("reports busy when an idle session has a live active job", () => {
    // This is the regression the whole feature exists to fix: the Stop hook
    // fires for the interactive session and says nothing about the fork.
    const got = paneActivity(
      state({ status: "idle", background: [job({ detail: "still working" })] }),
      seen("job-1"),
      NOW,
    );
    expect(got).toEqual({ activity: "busy", reason: "still working" });
  });

  it("reports waiting when an idle session has a live blocked job", () => {
    const got = paneActivity(
      state({ status: "idle", background: [job({ tempo: "blocked", detail: "needs input" })] }),
      seen("job-1"),
      NOW,
    );
    expect(got).toEqual({ activity: "waiting", reason: "needs input" });
  });

  it("stays idle when the only job is stale", () => {
    expect(
      paneActivity(
        state({ status: "idle", background: [job({ updated_at: STALE })] }),
        seen("job-1"),
        NOW,
      ).activity,
    ).toBe("idle");
  });

  it("lets the interactive waiting status win over a merely active job", () => {
    const got = paneActivity(
      state({
        status: "waiting",
        waiting_for: "needs permission",
        background: [job()],
      }),
      seen("job-1"),
      NOW,
    );
    expect(got).toEqual({ activity: "waiting", reason: "needs permission" });
  });

  it("escalates to waiting when a blocked job sits under a busy session", () => {
    // The severity fold, not a source-ordered chain: a blocked fork needs the
    // user even while the main session is mid-turn.
    const got = paneActivity(
      state({ status: "busy", background: [job({ tempo: "blocked", detail: "needs input" })] }),
      seen("job-1"),
      NOW,
    );
    expect(got).toEqual({ activity: "waiting", reason: "needs input" });
  });

  it("stays busy when a busy session's only job is merely active", () => {
    const got = paneActivity(
      state({ status: "busy", background: [job({ tempo: "active" })] }),
      seen("job-1"),
      NOW,
    );
    expect(got).toEqual({ activity: "busy", reason: null });
  });
});

describe("tabActivity", () => {
  it("returns none for a tab with no panes", () => {
    expect(tabActivity([])).toEqual({ activity: "none", reason: null });
  });

  it("ranks waiting above busy", () => {
    const got = tabActivity([
      { activity: "busy", reason: null },
      { activity: "waiting", reason: "needs permission" },
    ]);
    expect(got).toEqual({ activity: "waiting", reason: "needs permission" });
  });

  it("ranks busy above idle and idle above none", () => {
    expect(
      tabActivity([{ activity: "idle", reason: null }, { activity: "busy", reason: null }]).activity,
    ).toBe("busy");
    expect(
      tabActivity([{ activity: "none", reason: null }, { activity: "idle", reason: null }]).activity,
    ).toBe("idle");
  });
});
