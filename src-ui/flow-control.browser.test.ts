import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// PTY output flow control. The Rust reader thread forwards bytes as fast as
// the shell produces them; xterm.js parses at ~4-12 MB/s. Without back
// pressure a 100 MB `cat` queued ~80 MB of base64 in the webview (780 MB
// peak, measured on 1.2.5). The reader now waits for the frontend to
// acknowledge chunks, and the acknowledgement must come from xterm's write
// callback, i.e. only once the bytes are actually parsed.

type OutputCb = (data: Uint8Array, ack: () => void) => void;
let outputCb: OutputCb | null = null;

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn(async (_id: number, cb: OutputCb) => {
    outputCb = cb;
    return () => {};
  }),
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

// mock-ok(@xterm/addon-webgl): checks only that PTY output is acked after xterm parses it; nothing here depends on what the renderer draws.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
    onContextLoss() { return { dispose() {} }; }
  },
}));

import { createTerminalSession } from "./terminal";

describe("PTY output acknowledgement", () => {
  let parent: HTMLElement;
  let session: Awaited<ReturnType<typeof createTerminalSession>> | null = null;

  beforeEach(() => {
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
    outputCb = null;
  });

  afterEach(() => {
    session?.dispose();
    session = null;
    parent.remove();
  });

  it("acks a chunk only after xterm has parsed it", async () => {
    session = await createTerminalSession(parent);
    expect(outputCb).not.toBeNull();

    const ack = vi.fn();
    outputCb!(new TextEncoder().encode("hello flow\r\n"), ack);
    // xterm parses writes asynchronously; the ack must not be synchronous.
    expect(ack).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(ack).toHaveBeenCalledTimes(1));
    const line = session.term.buffer.active.getLine(0)?.translateToString(true);
    expect(line).toBe("hello flow");
  });
});
