import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// Regression (Sentry: "undefined is not an object (evaluating 'o.cwd')",
// thrown from provideLinks under _handleMouseMove):
// createTerminalSession runs synchronously up to `await createPty(...)`, and
// by then the terminal is already in the DOM and hoverable, the OSC 7 handler
// is registered and the file-path link provider is live. But `session` — the
// object both of those closed over as `session.cwd` — is only assigned after
// createPty and two more awaited PTY listener registrations have resolved.
// Moving the mouse over a brand-new pane inside that window called
// `getCwd()` → `session.cwd` on an undefined `session`, and because
// provideLinks is async the TypeError surfaced as an unhandled rejection.
//
// The fix keeps the cwd in a local that exists from the first line of the
// function; `session.cwd` is an accessor over it.

// createPty stays pending until the test releases it, holding the session in
// the exact window where `session` is still undefined.
let releasePty: ((id: number) => void) | null = null;
vi.mock("./pty", () => ({
  createPty: vi.fn(() => new Promise<number>((resolve) => { releasePty = resolve; })),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

// Capture the getCwd callback the link provider is handed. Calling it is what
// a hover does, minus xterm's mouse plumbing.
let capturedGetCwd: (() => string | null) | null = null;
vi.mock("./file-path-links", () => ({
  attachFilePathLinks: (_term: unknown, getCwd: () => string | null) => {
    capturedGetCwd = getCwd;
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), openPath: vi.fn(), revealItemInDir: vi.fn() }));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
    onContextLoss() { return { dispose() {} }; }
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => Promise.resolve(() => {}) }),
}));

import { createTerminalSession, type TerminalSession } from "./terminal";

describe("cwd read before the session object exists", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
    releasePty = null;
    capturedGetCwd = null;
  });

  afterEach(() => {
    parent.remove();
  });

  it("hovering while the PTY is still being created reads null, not a TypeError", async () => {
    const pending = createTerminalSession(parent);

    // Synchronous up to `await createPty`, so the provider already has its
    // callback while `session` is still undefined.
    expect(capturedGetCwd).not.toBeNull();
    expect(releasePty).not.toBeNull();

    expect(() => capturedGetCwd!()).not.toThrow();
    expect(capturedGetCwd!()).toBeNull();

    releasePty!(1);
    const session = await pending;
    session.dispose();
  });

  it("still reports the OSC 7 cwd once the session is up", async () => {
    const pending = createTerminalSession(parent);
    releasePty!(1);
    const session: TerminalSession = await pending;

    await new Promise<void>((r) => session.term.write("\x1b]7;file://localhost/tmp\x07", r));

    expect(session.cwd).toBe("/tmp");
    expect(capturedGetCwd!()).toBe("/tmp");
    session.dispose();
  });
});
