import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createKimboState, Mood } from "./kimbo-state";

describe("kimbo-state", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts idle", () => {
    const s = createKimboState();
    expect(s.current()).toBe<Mood>("idle");
  });

  it("trigger sets current mood", () => {
    const s = createKimboState();
    s.trigger("happy");
    expect(s.current()).toBe<Mood>("happy");
  });

  it("returns to idle after mood duration", () => {
    const s = createKimboState();
    s.trigger("happy"); // duration 1200
    vi.advanceTimersByTime(1199);
    expect(s.current()).toBe<Mood>("happy");
    vi.advanceTimersByTime(2);
    expect(s.current()).toBe<Mood>("idle");
  });

  it("higher priority pre-empts current reaction", () => {
    const s = createKimboState();
    s.trigger("happy");      // priority 4
    s.trigger("sad");        // priority 5
    expect(s.current()).toBe<Mood>("sad");
  });

  it("equal priority replaces current (newest wins)", () => {
    const s = createKimboState();
    s.trigger("happy");      // priority 4
    s.trigger("excited");    // priority 4
    expect(s.current()).toBe<Mood>("excited");
  });

  it("lower priority is dropped", () => {
    const s = createKimboState();
    s.trigger("sad");        // priority 5
    s.trigger("curious");    // priority 3
    expect(s.current()).toBe<Mood>("sad");
  });

  it("20th consecutive happy triggers love", () => {
    const s = createKimboState();
    for (let i = 0; i < 19; i++) {
      s.trigger("happy");
      vi.advanceTimersByTime(1300); // past duration, back to idle
    }
    s.trigger("happy");
    expect(s.current()).toBe<Mood>("love");
  });

  it("non-happy trigger resets happy counter", () => {
    const s = createKimboState();
    for (let i = 0; i < 10; i++) { s.trigger("happy"); vi.advanceTimersByTime(1300); }
    s.trigger("sad"); vi.advanceTimersByTime(1900);
    for (let i = 0; i < 19; i++) { s.trigger("happy"); vi.advanceTimersByTime(1300); }
    expect(s.current()).not.toBe<Mood>("love"); // counter was reset — love NOT promoted
  });

  it("user-typed idle timer: sleepy after idle duration", () => {
    const s = createKimboState({ idleMs: 5000 });
    s.noteActivity();
    vi.advanceTimersByTime(4999);
    expect(s.current()).toBe<Mood>("idle");
    vi.advanceTimersByTime(2);
    expect(s.current()).toBe<Mood>("sleepy");
  });

  it("user-typed cancels sleepy", () => {
    const s = createKimboState({ idleMs: 5000 });
    vi.advanceTimersByTime(5001);
    expect(s.current()).toBe<Mood>("sleepy");
    s.noteActivity();
    expect(s.current()).toBe<Mood>("idle");
  });

  it("notifies subscribers on mood change", () => {
    const s = createKimboState();
    const seen: Mood[] = [];
    s.subscribe((m) => seen.push(m));
    s.trigger("happy");
    vi.advanceTimersByTime(1300);
    expect(seen).toEqual(["happy", "idle"]);
  });

  it("focused enters on command-start-long and exits on command-end", () => {
    const s = createKimboState();
    s.trigger("focused"); // special: stays until explicit release
    vi.advanceTimersByTime(10000);
    expect(s.current()).toBe<Mood>("focused");
    s.release("focused");
    expect(s.current()).toBe<Mood>("idle");
  });
});
