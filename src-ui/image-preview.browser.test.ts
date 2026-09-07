import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

import { createImagePreview } from "./image-preview";

// The popover is placed the moment it is inserted, when the <img> has no
// intrinsic size yet, and it then grows to the image's dimensions. jsdom sees
// none of that: no layout, so no measurement, so no way to catch a popover
// that ends up hanging off the bottom or the right of the window. This needs
// a real browser.

/** A hover target standing in for a link box at the given point. */
function at(x: number, y: number) {
  return {
    rect: { left: x, right: x + 40, top: y, bottom: y + 10 },
    pointer: { x, y },
  };
}

/** A PNG large enough that the thumbnail hits its 360px ceiling. */
function largePngBase64(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#cc6666";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1];
}

const shown: Array<{ dispose(): void }> = [];

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  for (const p of shown.splice(0)) p.dispose();
  document.querySelector(".image-preview")?.remove();
});

/** Resolve once the thumbnail has decoded and the browser has laid it out. */
async function settled(): Promise<HTMLElement> {
  const el = document.querySelector<HTMLElement>(".image-preview")!;
  const img = el.querySelector("img")!;
  if (!img.complete) {
    await new Promise((res) => img.addEventListener("load", res, { once: true }));
  }
  await new Promise(requestAnimationFrame);
  return el;
}

describe("image preview placement in a real viewport", () => {
  it("stays inside the window when hovered at the bottom-right corner", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const preview = createImagePreview();

    await preview.show("/tmp/shot.png", at(window.innerWidth - 4, window.innerHeight - 4));
    const rect = (await settled()).getBoundingClientRect();

    expect(rect.width).toBeGreaterThan(100); // the image really did lay out
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);

    preview.dispose();
  });

  it("sits above a pointer that has room above it", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const preview = createImagePreview();

    const y = window.innerHeight - 40;
    await preview.show("/tmp/shot.png", at(20, y));
    const rect = (await settled()).getBoundingClientRect();

    expect(rect.bottom).toBeLessThanOrEqual(y);

    preview.dispose();
  });
});

describe("image preview against the app's own layout", () => {
  // #app-frame carries `transform: translateZ(0)` (it promotes the window
  // chrome to its own layer so the rounded corners clip the xterm canvas), and
  // the pane and terminal container both set `overflow: hidden`. A transformed
  // ancestor becomes the containing block for position:fixed descendants, so a
  // popover parented inside the terminal is positioned relative to the frame
  // and clipped by the pane instead of floating over the window. Every other
  // floating layer in the app (dropdown.ts, the context menus, toasts) parents
  // itself to document.body for exactly this reason.
  it("uses true viewport coordinates from inside a transformed, clipped pane", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const FRAME_TOP = 300;
    const frame = document.createElement("div");
    frame.style.cssText =
      `position:absolute;left:20px;top:${FRAME_TOP}px;width:300px;height:200px;` +
      "transform:translateZ(0);overflow:hidden;isolation:isolate;";
    const pane = document.createElement("div");
    pane.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;";
    frame.appendChild(pane);
    document.body.appendChild(frame);

    // A pointer above the frame, as it would be in the real window where the
    // frame fills everything. The popover drops below the pointer because a
    // 360px thumbnail does not fit above it.
    await showAt(200);
    const rect = (await settled()).getBoundingClientRect();

    // Placed just below the pointer in viewport space. Parented under the
    // transformed frame instead, the same computed offset would land it 300px
    // lower, past the frame's own top edge.
    expect(rect.top).toBeGreaterThan(150);
    expect(rect.top).toBeLessThan(FRAME_TOP);

    frame.remove();
  });

  /** Show the thumbnail at x=40 and the given viewport y, then tidy up after. */
  async function showAt(y: number): Promise<void> {
    const preview = createImagePreview();
    shown.push(preview);
    await preview.show("/tmp/shot.png", at(40, y));
  }
});

describe("image preview placement is right the first time", () => {
  // place() runs as soon as the popover is inserted. The caption is already
  // laid out at that point, so offsetHeight reports the caption's ~25px rather
  // than the ~390px the popover becomes once the image is in: the popover was
  // pinned just above the pointer, then grew down over the line being read,
  // and only a later re-place moved it. Measuring before any load handler
  // could run is what catches that.
  it("is inside the viewport as soon as show resolves", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const preview = createImagePreview();
    shown.push(preview);

    await preview.show("/tmp/shot.png", at(40, window.innerHeight - 40));
    const rect = document
      .querySelector(".image-preview")!
      .getBoundingClientRect();

    expect(rect.height).toBeGreaterThan(100); // the image is already laid out
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(rect.top).toBeGreaterThanOrEqual(0);
  });

  it("does not cover the line the pointer is on", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const preview = createImagePreview();
    shown.push(preview);

    const y = window.innerHeight - 40;
    await preview.show("/tmp/shot.png", at(40, y));
    const rect = document
      .querySelector(".image-preview")!
      .getBoundingClientRect();

    expect(rect.bottom).toBeLessThanOrEqual(y);
  });
});

describe("image preview is centred on the link", () => {
  // xterm re-acquires the hovered link on every repaint and reports the
  // pointer's latest position, so a thumbnail placed from the pointer hopped
  // across the screen as output streamed. Placed from the link's own box it
  // holds still while the pointer travels along it.
  it("centres horizontally on the link and sits above it", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const preview = createImagePreview();
    shown.push(preview);

    const link = { left: 60, right: 260, top: 500, bottom: 512 };
    await preview.show("/tmp/shot.png", { rect: link, pointer: { x: 200, y: 505 } });
    const rect = (await settled()).getBoundingClientRect();

    const linkCentre = (link.left + link.right) / 2;
    // Centred on the link, unless the window edge got in the way.
    if (rect.left > 8 && rect.right < window.innerWidth - 8) {
      expect((rect.left + rect.right) / 2).toBeCloseTo(linkCentre, 0);
    }
    // Above the link, not over it.
    expect(rect.bottom).toBeLessThanOrEqual(link.top);
  });

  it("does not move when the pointer travels along the same link", async () => {
    invokeMock.mockResolvedValue(largePngBase64());
    const preview = createImagePreview();
    shown.push(preview);

    const link = { left: 40, right: 300, top: 500, bottom: 512 };
    await preview.show("/tmp/shot.png", { rect: link, pointer: { x: 50, y: 505 } });
    const before = (await settled()).getBoundingClientRect();

    // Same link, pointer now at its far end: exactly the sequence that used
    // to make the thumbnail jump.
    await preview.show("/tmp/shot.png", { rect: link, pointer: { x: 295, y: 505 } });
    const after = document
      .querySelector(".image-preview")!
      .getBoundingClientRect();

    expect(after.left).toBeCloseTo(before.left, 5);
    expect(after.top).toBeCloseTo(before.top, 5);
  });
});
