import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSession,
  loadSession,
  clearSession,
  startSessionAutosave,
  type PersistedSession,
} from "./session-state";

describe("session-state: save and load", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a basic session", () => {
    saveSession({
      tabs: [
        { cwd: "/Users/luca/code", name: "code" },
        { cwd: "/tmp", name: "tmp" },
      ],
      activeIndex: 1,
    });
    const loaded = loadSession();
    expect(loaded?.tabs).toHaveLength(2);
    expect(loaded?.tabs[0]).toMatchObject({ cwd: "/Users/luca/code", name: "code" });
    expect(loaded?.activeIndex).toBe(1);
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSession()).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    localStorage.setItem("kimbo-session-v1", "{not json");
    expect(loadSession()).toBeNull();
  });

  it("returns null on JSON without a tabs array", () => {
    localStorage.setItem("kimbo-session-v1", JSON.stringify({ foo: "bar" }));
    expect(loadSession()).toBeNull();
  });

  it("drops unsafe cwds (non-absolute paths, NUL bytes)", () => {
    saveSession({
      tabs: [
        { cwd: "not-absolute", name: "bad-1" },
        { cwd: "/good/path", name: "good" },
        { cwd: "/has\0nul", name: "bad-2" },
        { cwd: null, name: "no-cwd" },
      ],
      activeIndex: 0,
    });
    const loaded = loadSession()!;
    expect(loaded.tabs.map((t) => t.cwd)).toEqual([null, "/good/path", null, null]);
  });

  it("clamps an out-of-range activeIndex down to a valid one", () => {
    saveSession({
      tabs: [{ cwd: "/a", name: "a" }, { cwd: "/b", name: "b" }],
      activeIndex: 42,
    });
    const loaded = loadSession()!;
    expect(loaded.activeIndex).toBe(1);
  });

  it("truncates overlong tab names to 64 chars", () => {
    const long = "x".repeat(200);
    saveSession({ tabs: [{ cwd: "/a", name: long }], activeIndex: 0 });
    expect(loadSession()!.tabs[0].name).toHaveLength(64);
  });

  it("saving an empty-tabs state is a no-op (doesn't wipe existing state)", () => {
    saveSession({ tabs: [{ cwd: "/keep", name: "keep" }], activeIndex: 0 });
    saveSession({ tabs: [], activeIndex: 0 });
    const loaded = loadSession()!;
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0].cwd).toBe("/keep");
  });

  it("clearSession removes the stored entry", () => {
    saveSession({ tabs: [{ cwd: "/a", name: "a" }], activeIndex: 0 });
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

describe("session-state: autosave polling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("writes through to storage on every snapshot change", () => {
    let snap: Omit<PersistedSession, "savedAt"> = {
      tabs: [{ cwd: "/one", name: "one" }],
      activeIndex: 0,
    };
    const stop = startSessionAutosave(() => snap, 1000);
    try {
      vi.advanceTimersByTime(1000);
      expect(loadSession()!.tabs[0].cwd).toBe("/one");

      snap = { tabs: [{ cwd: "/two", name: "two" }], activeIndex: 0 };
      vi.advanceTimersByTime(1000);
      expect(loadSession()!.tabs[0].cwd).toBe("/two");
    } finally {
      stop();
    }
  });

  it("skips identical snapshots (no write when nothing moved)", () => {
    const snap = { tabs: [{ cwd: "/x", name: "x" }], activeIndex: 0 };
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const stop = startSessionAutosave(() => snap, 500);
    try {
      vi.advanceTimersByTime(500);
      vi.advanceTimersByTime(500);
      vi.advanceTimersByTime(500);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      setItemSpy.mockRestore();
    }
  });

  it("stop() disposer halts further writes", () => {
    let snap = { tabs: [{ cwd: "/one", name: "one" }], activeIndex: 0 };
    const stop = startSessionAutosave(() => snap, 500);
    vi.advanceTimersByTime(500);
    stop();
    snap = { tabs: [{ cwd: "/two", name: "two" }], activeIndex: 0 };
    vi.advanceTimersByTime(2000);
    expect(loadSession()!.tabs[0].cwd).toBe("/one");
  });

  it("does not overwrite storage with a zero-tabs snapshot", () => {
    saveSession({ tabs: [{ cwd: "/keep", name: "keep" }], activeIndex: 0 });
    const stop = startSessionAutosave(
      () => ({ tabs: [], activeIndex: 0 }),
      500,
    );
    vi.advanceTimersByTime(2000);
    stop();
    expect(loadSession()!.tabs[0].cwd).toBe("/keep");
  });
});
