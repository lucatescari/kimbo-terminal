/** Turning a run of terminal cells into viewport pixels, kept pure and free of
 *  xterm so the arithmetic can be unit-tested. Used to place the hover
 *  thumbnail against the link it describes rather than against the pointer:
 *  xterm re-acquires the hovered link on every repaint and hands over the
 *  pointer's latest position, so anything placed from the pointer hops across
 *  the screen as output streams, and never quite keeps up. */
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The terminal's screen element in viewport coordinates. */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A run of cells on a single visible row. Columns are 0-based and `endX` is
 *  inclusive, matching xterm's own IBufferRange once its 1-based columns have
 *  been shifted down. `row` counts from the top of the viewport, not the
 *  buffer. */
export interface CellRun {
  startX: number;
  endX: number;
  row: number;
}

/** Where a run of cells sits on screen. The screen element is sized to exactly
 *  cols by rows cells, so dividing gives the true cell size including its
 *  fractional part; accumulating from the left edge rather than stepping keeps
 *  that fraction from drifting across a wide row. */
export function cellRunToRect(
  screen: ScreenBox,
  cols: number,
  rows: number,
  run: CellRun,
): Rect {
  const cellWidth = screen.width / cols;
  const cellHeight = screen.height / rows;
  return {
    left: screen.left + run.startX * cellWidth,
    right: screen.left + (run.endX + 1) * cellWidth,
    top: screen.top + run.row * cellHeight,
    bottom: screen.top + (run.row + 1) * cellHeight,
  };
}
