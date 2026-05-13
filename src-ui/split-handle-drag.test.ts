import { afterEach, describe, expect, it, vi } from "vitest";

// Unit tests for split-handle-drag.ts. These were written first to drive the
// implementation after a user-reported regression: the .split-handle div has
// always shown a col-resize/row-resize cursor, but no JS handler was wired up,
// so the divider between split panes was visually movable but functionally
// frozen. The fix attaches pointerdown/move/up listeners to the handle and
// rewrites the first sibling's flex-basis on drag.

import { attachSplitHandleDrag } from "./split-handle-drag";

interface Layout {
  containerSize: number; // px
  firstSize: number;     // px
}

function buildSplit(axis: "vertical" | "horizontal", layout: Layout) {
  const splitEl = document.createElement("div");
  splitEl.className = `pane-container ${axis}`;
  splitEl.style.display = "flex";
  splitEl.style.flexDirection = axis === "vertical" ? "row" : "column";

  const first = document.createElement("div");
  first.className = "pane";
  first.style.flex = "1";

  const handle = document.createElement("div");
  handle.className = `split-handle ${axis}`;

  const second = document.createElement("div");
  second.className = "pane";
  second.style.flex = "1";

  splitEl.appendChild(first);
  splitEl.appendChild(handle);
  splitEl.appendChild(second);
  document.body.appendChild(splitEl);

  // jsdom returns zeros for layout — stub the rects this test depends on.
  // Handle width/height is taken from offsetWidth/Height, also zero in jsdom;
  // the drag code falls back to zero when those are missing, which is fine.
  const containerRect = axis === "vertical"
    ? { left: 0, top: 0, right: layout.containerSize, bottom: 100, width: layout.containerSize, height: 100, x: 0, y: 0, toJSON: () => ({}) }
    : { left: 0, top: 0, right: 100, bottom: layout.containerSize, width: 100, height: layout.containerSize, x: 0, y: 0, toJSON: () => ({}) };
  const firstRect = axis === "vertical"
    ? { left: 0, top: 0, right: layout.firstSize, bottom: 100, width: layout.firstSize, height: 100, x: 0, y: 0, toJSON: () => ({}) }
    : { left: 0, top: 0, right: 100, bottom: layout.firstSize, width: 100, height: layout.firstSize, x: 0, y: 0, toJSON: () => ({}) };

  splitEl.getBoundingClientRect = () => containerRect as DOMRect;
  first.getBoundingClientRect = () => firstRect as DOMRect;

  // jsdom does not implement pointer capture — stub so the drag code's
  // try/catch doesn't fire and we can assert capture was requested.
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  (handle as any).setPointerCapture = setPointerCapture;
  (handle as any).releasePointerCapture = releasePointerCapture;

  return { splitEl, first, handle, second, setPointerCapture, releasePointerCapture };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("attachSplitHandleDrag: vertical", () => {
  it("resizes the first sibling when the handle is dragged right", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 600, clientY: 50, bubbles: true }));

    expect(first.style.flex).toBe("0 0 600px");
  });

  it("resizes the first sibling when the handle is dragged left", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 350, clientY: 50, bubbles: true }));

    expect(first.style.flex).toBe("0 0 350px");
  });

  it("ignores vertical pointer movement (clientY changes don't resize a vertical split)", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 500, clientY: 400, bubbles: true }));

    expect(first.style.flex).toBe("0 0 500px");
  });
});

describe("attachSplitHandleDrag: horizontal", () => {
  it("resizes the first sibling when the handle is dragged down", () => {
    const { first, handle } = buildSplit("horizontal", { containerSize: 800, firstSize: 400 });
    attachSplitHandleDrag(handle, "horizontal");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 50, clientY: 400, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 50, clientY: 530, bubbles: true }));

    expect(first.style.flex).toBe("0 0 530px");
  });

  it("ignores horizontal pointer movement (clientX changes don't resize a horizontal split)", () => {
    const { first, handle } = buildSplit("horizontal", { containerSize: 800, firstSize: 400 });
    attachSplitHandleDrag(handle, "horizontal");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 50, clientY: 400, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 300, clientY: 400, bubbles: true }));

    expect(first.style.flex).toBe("0 0 400px");
  });
});

describe("attachSplitHandleDrag: clamping", () => {
  it("clamps to a minimum so the first pane never collapses below the floor", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: -2000, clientY: 50, bubbles: true }));

    const match = first.style.flex.match(/0 0 (\d+)px/);
    expect(match).not.toBeNull();
    const px = Number(match![1]);
    expect(px).toBeGreaterThanOrEqual(80);
  });

  it("clamps to a maximum so the second pane never collapses below the floor", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 5000, clientY: 50, bubbles: true }));

    const match = first.style.flex.match(/0 0 (\d+)px/);
    expect(match).not.toBeNull();
    const px = Number(match![1]);
    expect(px).toBeLessThanOrEqual(1000 - 80);
  });
});

describe("attachSplitHandleDrag: pointer capture and cleanup", () => {
  it("requests pointer capture on pointerdown and releases on pointerup", () => {
    const { handle, setPointerCapture, releasePointerCapture } =
      buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, pointerId: 7, bubbles: true }));
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 500, clientY: 50, pointerId: 7, bubbles: true }));
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("stops responding to pointermove after pointerup", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 600, clientY: 50, bubbles: true }));
    expect(first.style.flex).toBe("0 0 600px");

    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 600, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 900, clientY: 50, bubbles: true }));
    // No further mutation after pointerup.
    expect(first.style.flex).toBe("0 0 600px");
  });

  it("treats pointercancel like pointerup (cleanup, no further resize)", () => {
    const { first, handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 600, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointercancel", { clientX: 600, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 900, clientY: 50, bubbles: true }));

    expect(first.style.flex).toBe("0 0 600px");
  });

  it("ignores right-clicks (button !== 0)", () => {
    const { first, handle, setPointerCapture } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    attachSplitHandleDrag(handle, "vertical");

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 2, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 600, clientY: 50, bubbles: true }));

    expect(setPointerCapture).not.toHaveBeenCalled();
    // No fixed basis was applied — first sibling still uses the equal-split flex.
    expect(first.style.flex).not.toMatch(/0 0 \d+px/);
  });
});

describe("attachSplitHandleDrag: onResize callback", () => {
  it("fires onResize on each pointermove during the drag", () => {
    const { handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    const onResize = vi.fn();
    attachSplitHandleDrag(handle, "vertical", onResize);

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 520, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 540, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 540, clientY: 50, bubbles: true }));

    // Two moves + one settle on up = 3.
    expect(onResize).toHaveBeenCalledTimes(3);
  });

  it("does not fire onResize without a drag in progress", () => {
    const { handle } = buildSplit("vertical", { containerSize: 1000, firstSize: 500 });
    const onResize = vi.fn();
    attachSplitHandleDrag(handle, "vertical", onResize);

    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 600, clientY: 50, bubbles: true }));
    expect(onResize).not.toHaveBeenCalled();
  });
});
