import { describe, it, expect, vi, beforeEach } from "vitest";

describe("playBeep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Drop the module-level AudioContext singleton so each test starts fresh
    // and genuinely exercises its own code path.
    vi.resetModules();
  });

  it("creates an oscillator and starts it", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const connect = vi.fn();
    const osc = { connect, start, stop, frequency: { value: 0 }, type: "sine" };
    const gain = { connect, gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
    const ctx = {
      createOscillator: vi.fn(() => osc),
      createGain: vi.fn(() => gain),
      currentTime: 0,
      destination: {},
    };
    // Constructable mock (regular function), so `new Ctor()` works.
    // @ts-expect-error test stub
    globalThis.AudioContext = vi.fn(function () {
      return ctx;
    });

    const { playBeep } = await import("./bell-sound");
    playBeep();

    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("does not throw if AudioContext is missing", async () => {
    // @ts-expect-error test stub
    globalThis.AudioContext = undefined;
    // @ts-expect-error test stub
    globalThis.webkitAudioContext = undefined;

    const { playBeep } = await import("./bell-sound");
    expect(() => playBeep()).not.toThrow();
  });
});
