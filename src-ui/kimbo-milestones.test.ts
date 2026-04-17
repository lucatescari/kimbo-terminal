import { describe, it, expect } from "vitest";
import { createMilestoneTracker } from "./kimbo-milestones";

function fixedClock(start: number) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    set: (v: number) => { t = v; },
  };
}

describe("milestone tracker", () => {
  it("greets based on time-of-day on app-start", () => {
    // 10:00 local — morning.
    const clk = fixedClock(new Date(2026, 3, 17, 10, 0, 0).getTime());
    const t = createMilestoneTracker({ now: clk.now });
    const r = t.onEvent({ type: "app-start" }, "idle");
    expect(r?.bubble).toBe("good morning!");
    expect(r?.mood).toBe("wave");
  });

  it("late-night greeting for 2am", () => {
    const clk = fixedClock(new Date(2026, 3, 17, 2, 0, 0).getTime());
    const t = createMilestoneTracker({ now: clk.now });
    const r = t.onEvent({ type: "app-start" }, "idle");
    expect(r?.bubble).toBe("late night, huh?");
  });

  it("tab-created milestones at 4 / 8 / 16 surfaces", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    const seq: Array<{ type: "tab-created" | "pane-split" | "project-opened" }> = [
      { type: "tab-created" }, { type: "pane-split" }, { type: "tab-created" }, { type: "project-opened" },
    ];
    const results = seq.map((e) => t.onEvent(e, "idle"));
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    expect(results[3]?.bubble).toBe("impressive!");
    for (let i = 0; i < 4; i++) t.onEvent({ type: "tab-created" }, "idle");
    expect(t.onEvent({ type: "tab-created" }, "idle")?.bubble).toBeUndefined();
    // Now at 9 surfaces; already passed 8 inside the loop.
  });

  it("success streak milestones at 10 and 25", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    // 1st command: "let's go!"
    expect(t.onEvent({ type: "command-end", exit: 0 }, "idle")?.bubble).toBe("let's go!");
    for (let i = 0; i < 8; i++) t.onEvent({ type: "command-end", exit: 0 }, "idle");
    // Streak now 9. Next makes 10.
    expect(t.onEvent({ type: "command-end", exit: 0 }, "idle")?.bubble).toBe("you're on fire!");
    for (let i = 0; i < 14; i++) t.onEvent({ type: "command-end", exit: 0 }, "idle");
    // Streak now 24. Next makes 25.
    expect(t.onEvent({ type: "command-end", exit: 0 }, "idle")?.bubble).toBe("unstoppable!");
  });

  it("fail streak milestone at 3 consecutive errors", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    expect(t.onEvent({ type: "command-end", exit: 1 }, "idle")?.bubble).toBeUndefined();
    expect(t.onEvent({ type: "command-end", exit: 1 }, "idle")?.bubble).toBeUndefined();
    const r = t.onEvent({ type: "command-end", exit: 1 }, "idle");
    expect(r?.bubble).toBe("you got this!");
    expect(r?.mood).toBe("sad");
  });

  it("success resets fail streak and vice versa", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    t.onEvent({ type: "command-end", exit: 1 }, "idle");
    t.onEvent({ type: "command-end", exit: 1 }, "idle");
    t.onEvent({ type: "command-end", exit: 0 }, "idle"); // first-command was exit=1 so this is not 1st
    // Now 2 more fails should NOT fire (streak reset).
    expect(t.onEvent({ type: "command-end", exit: 1 }, "idle")?.bubble).toBeUndefined();
    expect(t.onEvent({ type: "command-end", exit: 1 }, "idle")?.bubble).toBeUndefined();
  });

  it("kimbo-click milestones at 5 and 15", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    for (let i = 0; i < 4; i++) expect(t.onEvent({ type: "kimbo-click" }, "idle")).toBeNull();
    expect(t.onEvent({ type: "kimbo-click" }, "idle")?.bubble).toBe("hehe");
    for (let i = 0; i < 9; i++) t.onEvent({ type: "kimbo-click" }, "idle");
    expect(t.onEvent({ type: "kimbo-click" }, "idle")?.bubble).toBe("okay okay, I'm flattered!");
  });

  it("welcome-back fires when user-typed arrives while sleepy", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    const r = t.onEvent({ type: "user-typed" }, "sleepy");
    expect(r?.bubble).toBe("welcome back!");
    expect(r?.mood).toBe("happy");
  });

  it("typing burst fires after sustained typing", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now, burstGapMs: 3000, burstDurationMs: 20_000, burstCooldownMs: 300_000 });
    // Simulate 20 keystrokes, 1s apart.
    for (let i = 0; i < 20; i++) {
      const r = t.onEvent({ type: "user-typed" }, "idle");
      // Should not fire until span >= 20s.
      if (i < 19) expect(r).toBeNull();
      clk.advance(1000);
    }
    // 21st keystroke is at t=20s; span since burstStart (t=0) = 20_000 → fires.
    const r = t.onEvent({ type: "user-typed" }, "idle");
    expect(r?.bubble).toBe("in the zone!");
    expect(r?.mood).toBe("focused");
  });

  it("typing burst respects cooldown", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now, burstGapMs: 3000, burstDurationMs: 20_000, burstCooldownMs: 300_000 });
    for (let i = 0; i < 20; i++) { t.onEvent({ type: "user-typed" }, "idle"); clk.advance(1000); }
    expect(t.onEvent({ type: "user-typed" }, "idle")?.bubble).toBe("in the zone!");
    // Immediately keep typing — cooldown holds.
    for (let i = 0; i < 25; i++) { clk.advance(1000); t.onEvent({ type: "user-typed" }, "idle"); }
    // Advance past cooldown, type another sustained burst.
    clk.advance(300_000);
    for (let i = 0; i < 20; i++) { t.onEvent({ type: "user-typed" }, "idle"); clk.advance(1000); }
    expect(t.onEvent({ type: "user-typed" }, "idle")?.bubble).toBe("in the zone!");
  });

  it("pause longer than burstGap restarts the burst timer", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now, burstGapMs: 3000, burstDurationMs: 20_000, burstCooldownMs: 300_000 });
    // 10 seconds of typing, then pause, then 10 more — should NOT fire.
    for (let i = 0; i < 10; i++) { t.onEvent({ type: "user-typed" }, "idle"); clk.advance(1000); }
    clk.advance(5000);
    for (let i = 0; i < 10; i++) {
      const r = t.onEvent({ type: "user-typed" }, "idle");
      expect(r).toBeNull();
      clk.advance(1000);
    }
  });

  it("hourly uptime fires on the next event after 1h elapsed", () => {
    const clk = fixedClock(new Date(2026, 3, 17, 14, 0, 0).getTime());
    const t = createMilestoneTracker({ now: clk.now });
    // Just under 1h: no uptime fire.
    clk.advance(59 * 60_000);
    expect(t.onEvent({ type: "kimbo-click" }, "idle")?.bubble).toBe(undefined);
    // Cross 1h boundary.
    clk.advance(2 * 60_000);
    const r = t.onEvent({ type: "kimbo-click" }, "idle");
    expect(r?.bubble).toBe("an hour in!");
    expect(r?.mood).toBe("happy");
    // Second event soon after: no repeat.
    expect(t.onEvent({ type: "kimbo-click" }, "idle")?.bubble).not.toBe("an hour in!");
  });

  it("reset() clears counters", () => {
    const clk = fixedClock(0);
    const t = createMilestoneTracker({ now: clk.now });
    for (let i = 0; i < 4; i++) t.onEvent({ type: "kimbo-click" }, "idle");
    t.reset();
    // Streak should be zero — next 4 clicks shouldn't fire the 5-click milestone.
    for (let i = 0; i < 4; i++) expect(t.onEvent({ type: "kimbo-click" }, "idle")).toBeNull();
    expect(t.onEvent({ type: "kimbo-click" }, "idle")?.bubble).toBe("hehe");
  });
});
