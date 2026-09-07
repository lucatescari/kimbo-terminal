import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";

import { cellRunToRect } from "./cell-rect";

// The hover thumbnail is placed against the hovered link's box, which is
// derived from the ".xterm-screen" element and xterm's public `cols`/`rows`.
// If that selector or the element's geometry ever changes, linkRect returns
// null and the preview simply never appears: a silent failure no jsdom test
// can see, because jsdom reports a zero-sized box for everything.

let host: HTMLElement;
let term: Terminal;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:640px;height:320px;position:relative;";
  document.body.appendChild(host);
  term = new Terminal({ allowTransparency: true });
  term.open(host);
  term.write("hello");
});

afterEach(() => {
  term.dispose();
  host.remove();
});

describe("cell geometry against a real terminal", () => {
  it("finds the screen element and measures it", () => {
    const screen = term.element?.querySelector(".xterm-screen");

    expect(screen).toBeTruthy();
    const box = screen!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("maps the first cells of the first row inside the screen", () => {
    const box = term.element!
      .querySelector(".xterm-screen")!
      .getBoundingClientRect();

    const rect = cellRunToRect(
      { left: box.left, top: box.top, width: box.width, height: box.height },
      term.cols,
      term.rows,
      { startX: 0, endX: 4, row: 0 },
    );

    expect(rect.left).toBeCloseTo(box.left, 5);
    expect(rect.top).toBeCloseTo(box.top, 5);
    // Five cells of a monospace row: narrower than the screen, and a
    // plausible fraction of it.
    expect(rect.right).toBeGreaterThan(rect.left);
    expect(rect.right).toBeLessThan(box.right);
    expect(rect.bottom).toBeLessThan(box.bottom);
    expect(rect.right - rect.left).toBeCloseTo((box.width / term.cols) * 5, 5);
  });

  it("puts a lower row lower down, by exactly one row height", () => {
    const box = term.element!
      .querySelector(".xterm-screen")!
      .getBoundingClientRect();
    const screen = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };

    const first = cellRunToRect(screen, term.cols, term.rows, {
      startX: 0,
      endX: 0,
      row: 0,
    });
    const second = cellRunToRect(screen, term.cols, term.rows, {
      startX: 0,
      endX: 0,
      row: 1,
    });

    expect(second.top - first.top).toBeCloseTo(box.height / term.rows, 5);
  });
});
