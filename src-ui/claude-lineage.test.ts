// @vitest-environment jsdom
//
// Deciding what a Claude session transition MEANS is the whole risk in the
// branch/fork split feature, so it lives in a pure function that can be
// tested without a terminal, a PTY, or a running claude.
//
// The two commands leave different fingerprints, which is why one predicate
// cannot cover both:
//
//   /branch  the pane's OWN session id changes A -> B, and B's transcript
//            records forkedFrom.sessionId === A. The original stops running.
//   /fork    the pane's session id does NOT change. A new background session
//            appears alongside it and both keep running.
//
// The costly mistake here is splitting when nothing happened — most of all on
// startup, when every pane reports its session for the first time and a naive
// "id changed" check fires for all of them at once.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  classifyTransition,
  createLineageWatcher,
  AGENTS_MIN_INTERVAL_MS,
  ORIGIN_RETRY_POLLS,
  type LineageEvent,
  type AgentInfo,
  type LineageDeps,
} from "./claude-lineage";

const NONE: LineageEvent = { kind: "none" };

describe("classifyTransition", () => {
  it("says nothing on the first observation of a pane", () => {
    // Startup: Kimbo has never seen this pane before. Its session id is not
    // "new", we simply had not looked. Splitting here would split every pane
    // with claude already running, at launch, all at once.
    expect(
      classifyTransition({
        previousSessionId: null,
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("says nothing when a first observation coincides with a background session", () => {
    // Same startup case, but claude agents happens to report a background
    // session that has been running for hours. Not a fork we caused.
    expect(
      classifyTransition({
        previousSessionId: null,
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: ["bbbb"],
      }),
    ).toEqual(NONE);
  });

  it("says nothing when the session is unchanged and nothing else appeared", () => {
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("detects a branch when the new session was forked from the old one", () => {
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: "aaaa",
        newBackgroundSessionIds: [],
      }),
    ).toEqual({ kind: "branch", originSessionId: "aaaa", newSessionId: "bbbb" });
  });

  it("does NOT call it a branch when the session changed for another reason", () => {
    // The user quit claude and started a fresh one, or resumed something
    // unrelated. The id changed but there is no lineage, so there is no
    // original worth reopening.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: null,
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("does NOT call it a branch when forkedFrom points somewhere else", () => {
    // The new session is a branch of something, but not of what this pane was
    // running. Reopening "the original" would open a conversation the user
    // never had in this pane.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: "cccc",
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });

  it("detects a fork when a background session appears and the pane's session is unchanged", () => {
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: ["bbbb"],
      }),
    ).toEqual({ kind: "fork", forkSessionId: "bbbb" });
  });

  it("picks the last of several new background sessions", () => {
    // Callers pass these newest-last. Two appearing between polls is rare but
    // possible; acting on the most recent matches what the user just did.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: null,
        newBackgroundSessionIds: ["bbbb", "cccc"],
      }),
    ).toEqual({ kind: "fork", forkSessionId: "cccc" });
  });

  it("prefers the branch when a branch and a fork are both visible", () => {
    // A branch moves the pane's own conversation and is the more disruptive
    // of the two, so it wins. The fork is still a live background session and
    // remains reachable from claude agents.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "bbbb",
        forkedFromSessionId: "aaaa",
        newBackgroundSessionIds: ["cccc"],
      }),
    ).toEqual({ kind: "branch", originSessionId: "aaaa", newSessionId: "bbbb" });
  });

  it("never reports a branch whose origin is the session we are already in", () => {
    // Defensive: a self-referential forkedFrom would make Kimbo open a second
    // pane on the conversation already in front of the user.
    expect(
      classifyTransition({
        previousSessionId: "aaaa",
        currentSessionId: "aaaa",
        forkedFromSessionId: "aaaa",
        newBackgroundSessionIds: [],
      }),
    ).toEqual(NONE);
  });
});

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

function bg(session_id: string, cwd: string | null = "/w"): AgentInfo {
  return { session_id, kind: "background", cwd, name: null, state: null };
}

function harness(over: Partial<LineageDeps> = {}) {
  const splits: Array<{ event: LineageEvent; paneId: number }> = [];
  let clock = 100_000;
  let agents: AgentInfo[] = [];
  let listCalls = 0;
  let enabled = true;
  const origins = new Map<string, string>();

  const deps: LineageDeps = {
    sessionOrigin: async (id) => origins.get(id) ?? null,
    listAgents: async () => {
      listCalls++;
      return agents;
    },
    openSplit: async (event, paneId) => {
      splits.push({ event, paneId });
    },
    now: () => clock,
    enabled: () => enabled,
    ...over,
  };

  return {
    watcher: createLineageWatcher(deps),
    splits,
    origins,
    setAgents: (a: AgentInfo[]) => (agents = a),
    advance: (ms: number) => (clock += ms),
    calls: () => listCalls,
    setEnabled: (v: boolean) => (enabled = v),
  };
}

describe("lineage watcher", () => {
  it("does not split on the first sighting of a pane", async () => {
    const h = harness();
    await h.watcher.observe(1, "aaaa", "/w");
    expect(h.splits).toEqual([]);
  });

  it("splits once when a pane's session branches, and never again", async () => {
    const h = harness();
    await h.watcher.observe(1, "aaaa", "/w");
    h.origins.set("bbbb", "aaaa");
    await h.watcher.observe(1, "bbbb", "/w");
    expect(h.splits).toHaveLength(1);
    expect(h.splits[0].event).toEqual({
      kind: "branch",
      originSessionId: "aaaa",
      newSessionId: "bbbb",
    });

    // The pane's id stays changed, so a naive implementation re-splits forever.
    h.advance(10_000);
    await h.watcher.observe(1, "bbbb", "/w");
    h.advance(10_000);
    await h.watcher.observe(1, "bbbb", "/w");
    expect(h.splits).toHaveLength(1);
  });

  it("treats background sessions present at startup as pre-existing, not forks", async () => {
    const h = harness();
    h.setAgents([bg("old-1"), bg("old-2")]);
    await h.watcher.observe(1, "aaaa", "/w");
    h.advance(AGENTS_MIN_INTERVAL_MS + 1);
    await h.watcher.observe(1, "aaaa", "/w");
    expect(h.splits).toEqual([]);
  });

  it("splits once when a new background session appears", async () => {
    const h = harness();
    h.setAgents([bg("old-1")]);
    await h.watcher.observe(1, "aaaa", "/w");

    h.setAgents([bg("old-1"), bg("new-1")]);
    h.advance(AGENTS_MIN_INTERVAL_MS + 1);
    await h.watcher.observe(1, "aaaa", "/w");
    expect(h.splits).toHaveLength(1);
    expect(h.splits[0].event).toEqual({ kind: "fork", forkSessionId: "new-1" });

    h.advance(AGENTS_MIN_INTERVAL_MS + 1);
    await h.watcher.observe(1, "aaaa", "/w");
    expect(h.splits).toHaveLength(1);
  });

  it("ignores background sessions from another directory", async () => {
    const h = harness();
    h.setAgents([]);
    await h.watcher.observe(1, "aaaa", "/w");
    h.setAgents([bg("elsewhere", "/other")]);
    h.advance(AGENTS_MIN_INTERVAL_MS + 1);
    await h.watcher.observe(1, "aaaa", "/w");
    expect(h.splits).toEqual([]);
  });

  it("throttles the agents listing", async () => {
    // It spawns a login shell. Once per pane per poll would be brutal.
    const h = harness();
    await h.watcher.observe(1, "aaaa", "/w");
    const after1 = h.calls();
    await h.watcher.observe(2, "bbbb", "/w");
    await h.watcher.observe(3, "cccc", "/w");
    expect(h.calls()).toBe(after1);

    h.advance(AGENTS_MIN_INTERVAL_MS + 1);
    await h.watcher.observe(1, "aaaa", "/w");
    expect(h.calls()).toBe(after1 + 1);
  });

  it("does not ask for a session's origin when the id did not change", async () => {
    // The lookup scans ~/.claude/projects; doing it every poll would be waste.
    let originCalls = 0;
    const h = harness({
      sessionOrigin: async () => {
        originCalls++;
        return null;
      },
    });
    await h.watcher.observe(1, "aaaa", "/w");
    h.advance(10_000);
    await h.watcher.observe(1, "aaaa", "/w");
    expect(originCalls).toBe(0);
  });

  it("splits nothing while the pref is off, and does not treat the session as new when it comes back on", async () => {
    const h = harness();
    h.setEnabled(false);
    await h.watcher.observe(1, "aaaa", "/w");
    h.origins.set("bbbb", "aaaa");
    await h.watcher.observe(1, "bbbb", "/w");
    expect(h.splits).toEqual([]);

    // Re-enabled: the pane is at bbbb and has been for a while. That is not a
    // branch that just happened, and re-splitting on it would be a surprise.
    h.setEnabled(true);
    h.advance(10_000);
    await h.watcher.observe(1, "bbbb", "/w");
    expect(h.splits).toEqual([]);
  });

  it("survives a failing agents listing without splitting or throwing", async () => {
    const h = harness({
      listAgents: async () => {
        throw new Error("claude not found");
      },
    });
    await expect(h.watcher.observe(1, "aaaa", "/w")).resolves.toBeUndefined();
    expect(h.splits).toEqual([]);
  });

  it("does not retry a split that failed", async () => {
    // Retrying would produce a split attempt every few seconds for the life of
    // the pane, which is far worse than silently not splitting once.
    let attempts = 0;
    const h = harness({
      openSplit: async () => {
        attempts++;
        throw new Error("no room to split");
      },
    });
    await h.watcher.observe(1, "aaaa", "/w");
    h.origins.set("bbbb", "aaaa");
    await h.watcher.observe(1, "bbbb", "/w");
    h.advance(10_000);
    await h.watcher.observe(1, "bbbb", "/w");
    expect(attempts).toBe(1);
  });

  it("does not consult the agents listing to detect a branch", async () => {
    // The listing spawns a login shell. Putting it on the branch path made
    // every branch wait on that shell for no reason — a branch is fully
    // described by the pane's id change plus the new transcript's forkedFrom.
    let listCalls = 0;
    const h = harness({
      listAgents: async () => {
        listCalls++;
        return [];
      },
    });
    await h.watcher.observe(1, "aaaa", "/w");
    const baseline = listCalls;

    h.origins.set("bbbb", "aaaa");
    h.advance(60_000); // throttle wide open, so only the code path decides
    await h.watcher.observe(1, "bbbb", "/w");

    expect(h.splits).toHaveLength(1);
    expect(listCalls, "branch detection must not shell out").toBe(baseline);
  });

  it("retries when the branch transcript has not landed yet", async () => {
    // The transcript is written by another process, so the poll that first
    // sees the new id can beat forkedFrom to disk. Losing the branch there
    // would be permanent: by the next poll the id is no longer "changed".
    const h = harness();
    await h.watcher.observe(1, "aaaa", "/w");

    // forkedFrom not readable yet.
    await h.watcher.observe(1, "bbbb", "/w");
    expect(h.splits).toEqual([]);

    // It lands.
    h.origins.set("bbbb", "aaaa");
    await h.watcher.observe(1, "bbbb", "/w");
    expect(h.splits).toHaveLength(1);
    expect(h.splits[0].event).toEqual({
      kind: "branch",
      originSessionId: "aaaa",
      newSessionId: "bbbb",
    });
  });

  it("gives up retrying, so a plain restart is not re-checked forever", async () => {
    let originCalls = 0;
    const h = harness({
      sessionOrigin: async () => {
        originCalls++;
        return null;
      },
    });
    await h.watcher.observe(1, "aaaa", "/w");
    for (let i = 0; i < ORIGIN_RETRY_POLLS + 4; i++) {
      await h.watcher.observe(1, "bbbb", "/w");
    }
    expect(h.splits).toEqual([]);
    expect(originCalls).toBeLessThanOrEqual(ORIGIN_RETRY_POLLS + 1);
  });

  it("forgets a closed pane so a reused id is not a phantom branch", async () => {
    const h = harness();
    await h.watcher.observe(1, "aaaa", "/w");
    h.watcher.forgetPane(1);
    h.origins.set("bbbb", "aaaa");
    await h.watcher.observe(1, "bbbb", "/w");
    // First sighting again — no split.
    expect(h.splits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Split target preference
// ---------------------------------------------------------------------------

describe("split target preference", () => {
  it("defaults to a side-by-side split, with auto-open on", async () => {
    // DEFAULTS is module-private, so assert through the accessor with nothing
    // stored — which is what a fresh install actually sees.
    localStorage.clear();
    const { getPrefs } = await import("./ui-prefs");
    expect(getPrefs().claudeSplitTarget).toBe("vertical");
    expect(getPrefs().claudeAutoSplitBranches).toBe(true);
  });

  it("offers exactly the three targets the settings row advertises", async () => {
    // The two split values are passed straight through as a SplitAxis, so a
    // fourth value added here without handling it would open nothing.
    const settings = readFileSync(resolve(__dirname, "settings.ts"), "utf-8");
    // Anchored on "], (v)" — the real end of the options array. A plain
    // non-greedy \] stops at the first entry's own bracket.
    const block =
      /select\(prefs\.claudeSplitTarget, \[([\s\S]*?)\], \(v\)/.exec(settings)?.[1] ?? "";
    const values = Array.from(block.matchAll(/\["([a-z]+)",/g)).map((m) => m[1]);
    expect(values).toEqual(["vertical", "horizontal", "tab"]);
  });

  it("handles every target value in the split logic", async () => {
    // "tab" takes the createTab path; anything else is used verbatim as the
    // split axis. This pins that no value can fall through unhandled.
    const src = readFileSync(resolve(__dirname, "claude-lineage-split.ts"), "utf-8");
    expect(src).toContain('target === "tab"');
    expect(src).toContain("createTab(");
    expect(src).toContain("splitLeaf(");
  });
});
