import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// Every terminal keeps its own WebGL context, and WKWebView backs each one
// with IOSurfaces shared with the GPU process. Measured on 1.2.5: ~50 MB of
// graphics memory per tab, kept alive while the tab is hidden. A hidden tab
// renders nothing, so it should not hold a GPU renderer at all: suspend it
// when the tab goes out of view and recreate it when the tab comes back.

let constructed = 0;
let disposed = 0;

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() { constructed++; }
    activate() {}
    dispose() { disposed++; }
    onContextLoss() { return { dispose() {} }; }
  },
}));

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(), openPath: vi.fn(), revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => new Promise<() => void>(() => {}),
  }),
}));

import { createTerminalSession } from "./terminal";

async function nextFrame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

describe("GPU renderer on hidden tabs", () => {
  let parent: HTMLElement;
  let session: Awaited<ReturnType<typeof createTerminalSession>> | null = null;

  beforeEach(() => {
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
    constructed = 0;
    disposed = 0;
  });

  afterEach(() => {
    session?.dispose();
    session = null;
    parent.remove();
  });

  it("releases the WebGL addon when the session is hidden", async () => {
    session = await createTerminalSession(parent);
    await nextFrame();
    expect(constructed).toBe(1);

    session.setVisible(false);
    expect(disposed).toBe(1);
  });

  it("does not recreate the addon on window focus while hidden", async () => {
    session = await createTerminalSession(parent);
    await nextFrame();
    session.setVisible(false);

    // Cmd-Tab back to Kimbo: the context-loss restore path runs on focus.
    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    expect(constructed).toBe(1);
  });

  it("recreates the addon when the session becomes visible again", async () => {
    session = await createTerminalSession(parent);
    await nextFrame();
    session.setVisible(false);

    session.setVisible(true);
    await nextFrame();
    expect(constructed).toBe(2);
  });

  it("is a no-op when visibility does not change", async () => {
    session = await createTerminalSession(parent);
    await nextFrame();

    session.setVisible(true);
    await nextFrame();
    expect(constructed).toBe(1);
    expect(disposed).toBe(0);
  });
});
