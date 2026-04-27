import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// Mock the PTY layer so createTerminalSession can run in the browser test
// environment without a real backend. We capture closePty calls on a spy so
// the test can assert close_pty fired.
const closePtySpy = vi.fn(async (_id: number) => undefined);

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: (...args: unknown[]) => closePtySpy(...(args as [number])),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// Headless Chromium doesn't give WebglAddon a real GL context; stub it out to
// avoid unrelated null-deref noise in the dispose path.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
    onContextLoss() { return { dispose() {} }; }
  },
}));

import { createTerminalSession } from "./terminal";

describe("dispose() resilience", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
    closePtySpy.mockClear();
  });

  afterEach(() => {
    parent.remove();
  });

  it("invokes close_pty even when term.dispose() throws", async () => {
    const session = await createTerminalSession(parent);
    // Simulate the WebGL-context-loss case the comment in panes.ts:118
    // calls out: a thrown term.dispose() must NOT strand close_pty.
    vi.spyOn(session.term, "dispose").mockImplementation(() => {
      throw new Error("WebGL lost");
    });

    expect(() => session.dispose()).not.toThrow();

    expect(closePtySpy).toHaveBeenCalledTimes(1);
    expect(closePtySpy).toHaveBeenCalledWith(1);
  });

  it("invokes close_pty before term.dispose()", async () => {
    const session = await createTerminalSession(parent);
    const order: string[] = [];

    closePtySpy.mockImplementation(async (_id: number) => {
      order.push("close_pty");
      return undefined;
    });
    vi.spyOn(session.term, "dispose").mockImplementation(() => {
      order.push("term.dispose");
    });

    session.dispose();
    // closePty is fire-and-forget but its invoke call is synchronous from
    // the test's POV — the mock records the order. Wait one microtask so
    // the .catch chain settles before we read.
    await Promise.resolve();

    expect(order).toEqual(["close_pty", "term.dispose"]);
  });
});
