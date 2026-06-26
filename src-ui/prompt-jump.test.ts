import { describe, it, expect, vi } from "vitest";
import { pickTargetMarkerLine } from "./prompt-jump";

describe("pickTargetMarkerLine", () => {
  const lines = [5, 20, 40];
  it("prev picks the highest marker line above the viewport top", () => {
    expect(pickTargetMarkerLine(lines, 25, "prev")).toBe(20);
  });
  it("next picks the lowest marker line below the viewport top", () => {
    expect(pickTargetMarkerLine(lines, 25, "next")).toBe(40);
  });
  it("prev clamps to first when already above all", () => {
    expect(pickTargetMarkerLine(lines, 3, "prev")).toBe(5);
  });
  it("next clamps to last when already below all", () => {
    expect(pickTargetMarkerLine(lines, 100, "next")).toBe(40);
  });
  it("returns null for empty marker list", () => {
    expect(pickTargetMarkerLine([], 10, "prev")).toBe(null);
  });
});
