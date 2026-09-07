import { describe, it, expect } from "vitest";

import { cellRunToRect } from "./cell-rect";

// A 100x40 screen at 10 columns and 4 rows: cells are 10px by 10px, and the
// screen sits 5px right and 7px down from the window's top-left corner.
const SCREEN = { left: 5, top: 7, width: 100, height: 40 };

describe("cellRunToRect", () => {
  it("maps a run of cells on the first row to pixels", () => {
    const rect = cellRunToRect(SCREEN, 10, 4, { startX: 0, endX: 2, row: 0 });

    // Three cells wide, one cell tall, at the screen's origin.
    expect(rect).toEqual({ left: 5, right: 35, top: 7, bottom: 17 });
  });

  it("offsets by the row", () => {
    const rect = cellRunToRect(SCREEN, 10, 4, { startX: 0, endX: 0, row: 3 });

    expect(rect.top).toBe(37);
    expect(rect.bottom).toBe(47);
  });

  it("treats the end column as inclusive, as xterm's ranges are", () => {
    const one = cellRunToRect(SCREEN, 10, 4, { startX: 4, endX: 4, row: 0 });

    expect(one.right - one.left).toBe(10); // a single cell still has width
  });

  it("handles fractional cell sizes without drifting", () => {
    // Real cell widths are rarely whole pixels.
    const screen = { left: 0, top: 0, width: 101, height: 41 };
    const last = cellRunToRect(screen, 10, 4, { startX: 9, endX: 9, row: 3 });

    expect(last.right).toBeCloseTo(101, 6);
    expect(last.bottom).toBeCloseTo(41, 6);
  });
});
