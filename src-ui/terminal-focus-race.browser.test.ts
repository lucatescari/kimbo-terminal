import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// Regression: createTerminalSession registers a Tauri `onFocusChanged`
// listener; the returned unlisten function arrives asynchronously via a
// Promise. If session.dispose() runs BEFORE that Promise resolves (e.g. user
// opens then immediately closes a pane), the eventual unlisten was stored
// into a variable nobody read, and the Tauri-side listener leaked. Each leak
// kept a closure over the disposed `fit`/`term`, and every subsequent window
// focus fired a `restoreWebglAfterContextLoss` → `fit.fit()` on the dead
// terminal, throwing inside the focus handler. Over many open/close cycles
// the focus event got slower (N leaked listeners) which contributed to the
// "input feels laggy after extended use" report.
//
// The fix is a `disposed` flag checked when the Promise resolves: if we
// already disposed, call the unlisten immediately rather than storing it.

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), openPath: vi.fn(), revealItemInDir: vi.fn() }));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
    onContextLoss() { return { dispose() {} }; }
  },
}));

// Controllable Tauri focus mock. `onFocusChanged` returns a Promise that we
// expose via `resolveFocus` so the test can decide when (and whether) the
// unlisten function lands.
let resolveFocus: ((unlisten: () => void) => void) | null = null;
const tauriUnlistenSpy = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () =>
      new Promise<() => void>((resolve) => {
        resolveFocus = resolve;
      }),
  }),
}));

import { createTerminalSession } from "./terminal";

/** xterm.js schedules its initial viewport `syncScrollArea` on a RAF queued
    during `term.open()`. Disposing before that RAF runs makes it touch the
    nulled RenderService and throw — unrelated to what we're testing, but it
    pollutes the test output with unhandled errors. Wait two frames so the
    initial layout settles before any dispose. The race we want to exercise
    (dispose vs. Tauri Promise resolution) is unaffected because our mock
    never resolves the Promise on its own; the test still drives that timing. */
async function letXtermSettle(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

describe("Tauri focus-listener race in createTerminalSession", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
    resolveFocus = null;
    tauriUnlistenSpy.mockClear();
  });

  afterEach(() => {
    parent.remove();
  });

  it("calls the Tauri unlisten when dispose() runs BEFORE onFocusChanged resolves", async () => {
    const session = await createTerminalSession(parent);
    await letXtermSettle();

    // The session is alive but the Tauri Promise hasn't resolved yet — this
    // is the race window. Dispose now.
    expect(resolveFocus).not.toBeNull();
    session.dispose();

    // Now the Tauri Promise resolves, handing us the unlisten function. The
    // pre-fix code stored it into a variable that nothing read; the post-fix
    // code notices the session was disposed and calls unlisten immediately.
    resolveFocus!(tauriUnlistenSpy);

    // Allow the .then microtask to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(tauriUnlistenSpy).toHaveBeenCalledTimes(1);
  });

  it("calls the Tauri unlisten on dispose() when it resolved BEFORE dispose (no regression)", async () => {
    const session = await createTerminalSession(parent);
    await letXtermSettle();

    // Resolve the Promise FIRST so the unlisten lands in the normal slot.
    resolveFocus!(tauriUnlistenSpy);
    await Promise.resolve();
    await Promise.resolve();

    // Then dispose — should still call the unlisten exactly once.
    session.dispose();
    expect(tauriUnlistenSpy).toHaveBeenCalledTimes(1);
  });
});
