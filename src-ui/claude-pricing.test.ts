import { describe, it, expect } from "vitest";
import { estimateCost, PRICING } from "./claude-pricing";

describe("PRICING table", () => {
  it("includes opus, sonnet, haiku at expected per-Mtok rates", () => {
    expect(PRICING["claude-opus-4-7"]).toEqual({ input: 15, output: 75 });
    expect(PRICING["claude-sonnet-4-6"]).toEqual({ input: 3, output: 15 });
    expect(PRICING["claude-haiku-4-5"]).toEqual({ input: 1, output: 5 });
  });
});

describe("estimateCost", () => {
  it("computes cost in dollars from per-Mtok rates", () => {
    // 1M input @ $15 + 100K output @ $75 = $15 + $7.50 = $22.50
    expect(estimateCost("claude-opus-4-7", 1_000_000, 100_000)).toBeCloseTo(22.5);
  });

  it("returns null for unknown model", () => {
    expect(estimateCost("claude-totally-fake-9", 1, 1)).toBeNull();
  });

  it("returns null when model is null", () => {
    expect(estimateCost(null, 1, 1)).toBeNull();
  });

  it("zero tokens yields exactly $0", () => {
    expect(estimateCost("claude-opus-4-7", 0, 0)).toBe(0);
  });
});
