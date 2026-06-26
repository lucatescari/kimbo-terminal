import { describe, it, expect, vi, beforeEach } from "vitest";
import { playBeep } from "./bell-sound";

describe("playBeep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an oscillator and starts it", () => {
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
    // @ts-expect-error test stub
    globalThis.AudioContext = vi.fn(() => ctx);

    playBeep();

    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("does not throw if AudioContext is missing", () => {
    // @ts-expect-error test stub
    globalThis.AudioContext = undefined;
    expect(() => playBeep()).not.toThrow();
  });
});
