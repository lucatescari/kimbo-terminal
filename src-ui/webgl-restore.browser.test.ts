import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";

// Regression: a blank, completely unresponsive window after the machine runs
// short of memory.
//
// WKWebView fires WebGL context loss whenever the GPU process goes away, and
// under memory pressure macOS kills that process. createTerminalSession
// answers a loss by re-creating the WebglAddon on the next focus, which calls
// canvas.getContext("webgl2"). In WKWebView that call is a SYNCHRONOUS IPC to
// the GPU process:
//
//   requestAnimationFrame callback
//     -> HTMLCanvasElement.getContext("webgl2")
//       -> WebKit::RemoteGraphicsContextGLProxy::waitUntilInitialized()
//         -> IPC::Connection::waitForAndDispatchImmediately<...WasCreated>
//           -> __psynch_cvwait
//
// If the replacement GPU process cannot initialise -- which is exactly what a
// machine with 59 MB free and 9.8 GB of swap in use produces -- that reply
// never comes and the renderer's main thread parks in the kernel. The window
// paints nothing and answers no input, at 0% CPU, until the GPU process is
// killed by hand. Observed 2026-09-08 on 1.2.2-unstable.5; sampled stack in
// ~/Library/Logs/com.kimbo.terminal/freeze-2026-09-08/.
//
// The first stall cannot be prevented from JS: getContext is synchronous and
// gives us no timeout. What we can prevent is doing it AGAIN on every
// subsequent Cmd-Tab, which is what turns one stall into a window that is
// blank for the rest of the day. So: an attempt that blocked the main thread
// retires the GPU renderer for the session.

let constructed = 0;
let stallMs = 0;
let throwOnConstruct = false;
const contextLossHandlers: Array<() => void> = [];

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      constructed++;
      if (throwOnConstruct) throw new Error("WebGL unavailable");
      if (stallMs > 0) {
        // Block the main thread the way a wedged GPU process does.
        const until = performance.now() + stallMs;
        while (performance.now() < until) {
          /* spin */
        }
      }
    }
    activate() {}
    dispose() {}
    onContextLoss(cb: () => void) {
      contextLossHandlers.push(cb);
      return { dispose() {} };
    }
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
  openUrl: vi.fn(),
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => new Promise<() => void>(() => {}),
  }),
}));

import { createTerminalSession } from "./terminal";

/** xterm queues its initial viewport sync on a RAF from term.open(); let it run. */
async function letXtermSettle(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** The restore path defers one frame, so a focus event lands a frame later. */
async function nextFrame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

describe("WebGL context restore after the GPU process dies", () => {
  let parent: HTMLElement;
  // Held so afterEach can dispose even when an assertion fails mid-test: a
  // surviving session keeps its focus listener, and that listener would
  // create an addon during the NEXT test and skew its count.
  let session: Awaited<ReturnType<typeof createTerminalSession>> | null = null;

  beforeEach(() => {
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
    constructed = 0;
    stallMs = 0;
    throwOnConstruct = false;
    contextLossHandlers.length = 0;
  });

  afterEach(() => {
    session?.dispose();
    session = null;
    parent.remove();
  });

  it("retires the GPU renderer after an attempt blocks the main thread", async () => {
    session = await createTerminalSession(parent);
    await letXtermSettle();
    expect(constructed).toBe(1);

    // The GPU process dies; xterm reports the loss. The re-create succeeds,
    // but only after parking the main thread -- the signature of a GPU
    // process that is up but not answering.
    stallMs = 600;
    contextLossHandlers.forEach((cb) => cb());

    // One attempt is the price of finding out: nothing tells us the GPU is
    // unhealthy until a creation has already stalled on it.
    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    expect(constructed).toBe(2);

    // It stalled, so the next loss must NOT be answered with another
    // creation. Repeating it is what turns one stall into a window that is
    // blank for the rest of the session.
    contextLossHandlers.forEach((cb) => cb());
    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    document.dispatchEvent(new Event("visibilitychange"));
    await nextFrame();
    expect(constructed).toBe(2);
  });

  it("retires the GPU renderer when creation throws", async () => {
    session = await createTerminalSession(parent);
    await letXtermSettle();
    expect(constructed).toBe(1);

    throwOnConstruct = true;
    contextLossHandlers.forEach((cb) => cb());

    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    expect(constructed).toBe(2);

    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    expect(constructed).toBe(2);
  });

  it("still recovers normally when the GPU comes back promptly", async () => {
    session = await createTerminalSession(parent);
    await letXtermSettle();
    expect(constructed).toBe(1);

    // A healthy re-create: fast, no throw.
    contextLossHandlers.forEach((cb) => cb());
    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    expect(constructed).toBe(2);

    // A second loss later in the session is recovered too.
    contextLossHandlers.forEach((cb) => cb());
    window.dispatchEvent(new Event("focus"));
    await nextFrame();
    expect(constructed).toBe(3);
  });
});
