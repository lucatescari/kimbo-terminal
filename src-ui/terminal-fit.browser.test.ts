import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// Regression for: Claude Code (and other TUIs) started at 80×24 because the
// terminal session's initial fit.fit() ran while the pane element was still
// detached from the DOM — clientWidth was 0, xterm kept its default size,
// and the first resize_pty call propagated those stale dimensions to the
// PTY. The fix installs a ResizeObserver on the terminal container so we
// re-fit as soon as real layout happens post-attach; the RO fits fire
// term.onResize which in turn calls resize_pty with the correct dims.
//
// The test mocks the Tauri PTY invokes so we can watch what cols/rows get
// pushed to the backend, then reproduces the exact createLeaf sequence
// (detach → create session → attach) and asserts that resize_pty eventually
// sees dimensions bigger than 24 rows — proof the fix kicked in.

const resizePtyCalls: Array<{ id: number; cols: number; rows: number }> = [];

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(42),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockImplementation(async (id: number, cols: number, rows: number) => {
    resizePtyCalls.push({ id, cols, rows });
  }),
  closePty: vi.fn().mockResolvedValue(undefined),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// Headless Chromium doesn't give WebglAddon a real GL context, and the
// addon's internal cleanup has a null-deref path when disposed in that
// state. That's unrelated to what we're testing here, so stub the addon
// with a no-op shell whose dispose() does nothing. The real createTerminal
// Session path already wraps WebglAddon in try/catch, so swapping it out
// doesn't change any production behavior we care about.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
    onContextLoss() { return { dispose() {} }; }
  },
}));

// ResizeObserver settles on one `rAF` in Chromium; give it two to be safe.
async function waitForResizeObserver() {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

describe("createTerminalSession: initial sizing when pane is attached later", () => {
  beforeEach(() => { resizePtyCalls.length = 0; });

  let host: HTMLElement;
  afterEach(() => { host?.remove(); });

  it("detached-then-attached pane ends up with resize_pty called with the ATTACHED dimensions", async () => {
    // Import inside the test so vi.mock is in place before the module runs.
    const { createTerminalSession } = await import("./terminal");

    // Simulate the createLeaf pattern: build the pane element while it is
    // still detached from document.body — exactly how panes.ts:createLeaf
    // and panes.ts:createRootPane do it.
    const paneEl = document.createElement("div");
    paneEl.style.flex = "1";
    paneEl.style.minWidth = "0";
    paneEl.style.minHeight = "0";
    paneEl.style.display = "flex";
    paneEl.style.flexDirection = "column";
    // paneEl is intentionally NOT appended yet.

    const session = await createTerminalSession(paneEl);
    // Right after createTerminalSession, the pane is still detached. Calls
    // so far use xterm's default 80×24 — that's the pre-fix buggy behaviour.
    const callsBeforeAttach = resizePtyCalls.length;

    // Now attach to a real-sized host, mirroring createRootPane's
    // rootEl.appendChild(node.element). The ResizeObserver we installed
    // should notice and re-fit.
    host = document.createElement("div");
    host.style.width = "1280px";
    host.style.height = "720px";
    host.style.display = "flex";
    document.body.appendChild(host);
    host.appendChild(paneEl);

    await waitForResizeObserver();

    expect(
      resizePtyCalls.length,
      "ResizeObserver should have triggered at least one resize_pty after attach",
    ).toBeGreaterThan(callsBeforeAttach);

    const latest = resizePtyCalls[resizePtyCalls.length - 1];
    // xterm cell is ~8px × ~17px at fontSize 14, so 1280×720 → ≥ 60 cols / ≥ 20 rows.
    // If the fix didn't work, we'd still see the detached 80×24 (or smaller).
    // Rows is the tight signal because the bug caps at 24 rows.
    expect(latest.rows, "rows should reflect the attached pane height").toBeGreaterThan(24);
    expect(latest.cols).toBeGreaterThan(40);
    expect(latest.id).toBe(42); // the ptyId our mock returned

    session.dispose();
  });

  it("dispose() disconnects the ResizeObserver (no further resize_pty after dispose)", async () => {
    const { createTerminalSession } = await import("./terminal");

    host = document.createElement("div");
    host.style.width = "1024px";
    host.style.height = "600px";
    host.style.display = "flex";
    document.body.appendChild(host);

    const paneEl = document.createElement("div");
    paneEl.style.flex = "1";
    paneEl.style.minWidth = "0";
    paneEl.style.minHeight = "0";
    paneEl.style.display = "flex";
    paneEl.style.flexDirection = "column";

    // Attach BEFORE session creation so the fit has dims immediately.
    host.appendChild(paneEl);
    const session = await createTerminalSession(paneEl);
    await waitForResizeObserver();

    const callsBeforeDispose = resizePtyCalls.length;
    session.dispose();

    // Resize the host — a still-connected RO would trigger another resize_pty.
    host.style.width = "800px";
    host.style.height = "400px";
    await waitForResizeObserver();

    expect(
      resizePtyCalls.length,
      "RO should be disconnected after dispose so no more resize_pty fires",
    ).toBe(callsBeforeDispose);
  });
});
