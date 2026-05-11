import { describe, expect, it } from "vitest";
import { hexToHsl } from "./theme-filter";

describe("hexToHsl", () => {
  it("converts pure red", () => {
    const hsl = hexToHsl("#ff0000")!;
    expect(hsl.h).toBeCloseTo(0, 1);
    expect(hsl.s).toBeCloseTo(100, 1);
    expect(hsl.l).toBeCloseTo(50, 1);
  });

  it("converts pure green (hue 120)", () => {
    const hsl = hexToHsl("#00ff00")!;
    expect(hsl.h).toBeCloseTo(120, 1);
  });

  it("converts pure blue (hue 240)", () => {
    const hsl = hexToHsl("#0000ff")!;
    expect(hsl.h).toBeCloseTo(240, 1);
  });

  it("treats a mid-grey as zero saturation", () => {
    const hsl = hexToHsl("#888888")!;
    expect(hsl.s).toBeCloseTo(0, 1);
  });

  it("accepts hex without a leading #", () => {
    expect(hexToHsl("ff0000")).not.toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(hexToHsl("")).toBeNull();
    expect(hexToHsl("not-a-color")).toBeNull();
    expect(hexToHsl("#ff00")).toBeNull();
    expect(hexToHsl("#gggggg")).toBeNull();
  });
});
