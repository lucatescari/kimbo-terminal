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

    await preview.show("/tmp/shot.png", {
      x: window.innerWidth - 4,
      y: window.innerHeight - 4,
    });
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
    await preview.show("/tmp/shot.png", { x: 20, y });
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
    await preview.show("/tmp/shot.png", { x: 40, y });
  }
});
