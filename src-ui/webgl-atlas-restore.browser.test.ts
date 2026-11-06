import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";

// Mock the PTY layer so createTerminalSession can run without a backend.
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

interface FakeAddon {
  lossHandler?: () => void;
  disposed: boolean;
}

// `events` records the interleaving of addon construction and atlas clears so
// the ordering assertion below can prove the clear lands AFTER loadAddon:
// clearing while the WebGL renderer is not yet attached is a no-op.
const webgl = vi.hoisted(() => ({
  instances: [] as FakeAddon[],
  events: [] as string[],
}));

// The addon is stubbed here only to check call ORDER cheaply. Headless
// Chromium does have a working WebGL2 context, and this stub cannot see what
// the screen looks like, which is how a clear that scrambled every other pane
// passed review. Rendering behaviour is covered with the real addon in
// webgl-shared-atlas.browser.test.ts; put new rendering tests there.
// mock-ok(@xterm/addon-webgl): checks only the ORDER of addon load vs atlas clear; pixels are checked with the real addon in webgl-shared-atlas.browser.test.ts.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class implements FakeAddon {
    public lossHandler?: () => void;
    public disposed = false;
    constructor() {
      webgl.instances.push(this);
      webgl.events.push("addon-created");
    }
    public activate(): void {}
    public dispose(): void {
      this.disposed = true;
    }
    public onContextLoss(cb: () => void): { dispose(): void } {
      this.lossHandler = cb;
      return { dispose() {} };
    }
  },
}));

import { createTerminalSession } from "./terminal";

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

describe("WebGL glyph atlas after context loss", () => {
  let parent: HTMLElement;
  let session: Awaited<ReturnType<typeof createTerminalSession>> | undefined;
  let clearSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    webgl.instances.length = 0;
    webgl.events.length = 0;
    // Spied on the prototype, not the instance, because the first addon load
    // happens inside createTerminalSession before a session object exists.
    clearSpy = vi.spyOn(Terminal.prototype, "clearTextureAtlas").mockImplementation(() => {
      webgl.events.push("clear");
    });
    parent = document.createElement("div");
    parent.style.width = "640px";
    parent.style.height = "480px";
    document.body.appendChild(parent);
  });

  afterEach(() => {
    try {
      session?.dispose();
    } catch {
      /* ignore */
    }
    session = undefined;
    clearSpy.mockRestore();
    parent.remove();
  });

  /** Fire the context loss WebKit raises when its GPU process dies, then refocus. */
  const loseContextAndRefocus = async (): Promise<void> => {
    webgl.instances[0].lossHandler?.();
    window.dispatchEvent(new Event("focus"));
    // restoreWebglAfterContextLoss defers a frame; give it two to be safe.
    await nextFrame();
    await nextFrame();
  };

  it("does not clear the atlas on the first addon load", async () => {
    session = await createTerminalSession(parent);

    expect(webgl.instances).toHaveLength(1);
    // A fresh atlas has nothing to discard; clearing would cost a pointless
    // full re-raster on every terminal at startup.
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("clears the atlas when a replacement addon is loaded after context loss", async () => {
    session = await createTerminalSession(parent);
    expect(webgl.instances).toHaveLength(1);

    await loseContextAndRefocus();

    // A replacement addon was loaded...
    expect(webgl.instances).toHaveLength(2);
    // ...and the stale glyph atlas was discarded with it. Without this, the
    // module-global charAtlasCache hands the new addon the SAME TextureAtlas,
    // whose _cacheMap still marks every previously rasterized glyph resident
    // and so never re-rasterizes it. The glyphs whose page canvases WebKit
    // dropped under memory pressure then render as blank cells forever.
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("clears only after the replacement addon is attached", async () => {
    session = await createTerminalSession(parent);
    await loseContextAndRefocus();

    // clearTextureAtlas() reaches the WebGL renderer only once it is attached;
    // clearing before loadAddon would silently no-op against the fallback.
    expect(webgl.events).toEqual(["addon-created", "addon-created", "clear"]);
  });

  it("disposes the lost addon before replacing it", async () => {
    session = await createTerminalSession(parent);
    const first = webgl.instances[0];

    await loseContextAndRefocus();

    expect(first.disposed).toBe(true);
    expect(webgl.instances[1].disposed).toBe(false);
  });
});
