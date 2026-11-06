import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";

// Regression test for scrambled glyphs in panes that did NOT lose their GL
// context (2026-11, after PR #38).
//
// This test uses the REAL WebglAddon. Headless Chromium hands out a working
// WebGL2 context, so there is no reason to stub it, and stubbing it is what
// let the bug through: the PR #38 test replaced the addon with a fake and
// spied on clearTextureAtlas, so it could only check "was it called", never
// "what does the screen look like afterwards".
//
// The mechanism: addon-webgl caches the glyph atlas in a module global keyed
// by font/cell config (CharAtlasCache.ts), so every pane with the same font
// shares ONE TextureAtlas. Each pane's GlyphRenderer keeps per-cell vertex
// data holding that glyph's texture coordinates inside the shared atlas, and
// RenderModel skips cells whose content did not change. When one pane calls
// term.clearTextureAtlas(), the shared atlas is wiped and refilled from the
// top, but only THAT pane drops its model. Every other pane keeps pointing at
// coordinates that now hold different glyphs, and draws fragments of the
// wrong letters until each cell's content happens to change.

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

import { createTerminalSession } from "./terminal";

type Session = Awaited<ReturnType<typeof createTerminalSession>>;

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const write = (term: Terminal, data: string): Promise<void> => new Promise((r) => term.write(data, r));

// xterm internals, read-only, to render synchronously and read the GL buffer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const webglRenderer = (term: Terminal): any => (term as any)._core._renderService._renderer.value;

/** Render every row of `term` right now and return its WebGL pixels. */
function snapshot(term: Terminal): Uint8Array {
  const r = webglRenderer(term);
  expect(r?._gl, "pane must be on the WebGL renderer").toBeTruthy();
  r.renderRows(0, term.rows - 1);
  const gl = r._gl as WebGL2RenderingContext;
  const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function differingPixels(a: Uint8Array, b: Uint8Array): number {
  expect(a.length, "compared frames must be the same size").toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

/** Pixels that differ from the background (pixel 0 is the bottom-left
 *  corner in GL order: the empty last row). */
function inkPixels(px: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2]) n++;
  }
  return n;
}

/** The real context-loss path: GPU drops the context, xterm waits 3s for a
 *  restore that never comes, fires onContextLoss, then the window refocuses. */
async function loseContextAndRefocus(term: Terminal): Promise<void> {
  const gl = webglRenderer(term)._gl as WebGL2RenderingContext;
  gl.getExtension("WEBGL_lose_context")!.loseContext();
  await new Promise((r) => setTimeout(r, 3300));
  window.dispatchEvent(new Event("focus"));
  await nextFrame();
  await nextFrame();
}

// Hide the cursor so a pane's pixels depend on its text alone.
const HIDE_CURSOR = "\x1b[?25l";

describe("shared WebGL glyph atlas across panes", () => {
  const sessions: Session[] = [];
  const parents: HTMLElement[] = [];

  beforeAll(async () => {
    // Glyphs rasterized before the font arrives look different from glyphs
    // rasterized after, which would make any pixel comparison flaky.
    for (const family of ["JetBrains Mono", "JetBrainsMono Nerd Font Mono"]) {
      for (const size of [13, 14, 15, 16]) {
        await document.fonts.load(`${size}px '${family}'`, "abcxyzABCXYZ0123");
      }
    }
  });

  const openPane = async (text: string): Promise<Session> => {
    const parent = document.createElement("div");
    // Every pane gets the identical box, so their canvases match pixel for
    // pixel. Overlapping is fine: each reads back its own GL buffer.
    parent.style.cssText = "position:fixed;left:0;top:0;width:640px;height:240px;overflow:hidden";
    document.body.appendChild(parent);
    parents.push(parent);
    const s = await createTerminalSession(parent);
    sessions.push(s);
    await write(s.term, HIDE_CURSOR + text);
    return s;
  };

  /**
   * The pixels `term` SHOULD show: drop its cached per-cell glyph data and
   * render from scratch, so every glyph is looked up in the atlas again. A
   * pane whose cache is correct draws identically before and after this.
   */
  const fromScratch = (term: Terminal): Uint8Array => {
    webglRenderer(term)._clearModel(true);
    return snapshot(term);
  };

  afterEach(() => {
    for (const s of sessions.splice(0)) {
      try { s.dispose(); } catch { /* ignore */ }
    }
    for (const p of parents.splice(0)) p.remove();
  });

  it("a context loss in one pane leaves the text of the other panes intact", { timeout: 20_000 }, async () => {
    const textB = "the quick brown fox jumps over the lazy dog";
    const a = await openPane("hello world from pane a\r\n");
    const b = await openPane(textB);
    await nextFrame();
    await nextFrame();
    // Same font and size, so both panes draw from ONE shared atlas.
    expect(webglRenderer(a.term)._charAtlas).toBe(webglRenderer(b.term)._charAtlas);

    await loseContextAndRefocus(a.term);
    expect(webglRenderer(a.term)?._gl, "pane A got a replacement WebGL renderer").toBeTruthy();

    // Pane A draws glyphs B never used. They land in the atlas slots that B's
    // cached cell data still points at.
    await write(a.term, "ZYXWVUTSRQPONM 0123456789 !@#$%^&*()\r\n");
    await nextFrame();
    await nextFrame();

    // B's text never changed, so B must look like a fresh pane showing it.
    // B's text never changed. What it draws from its cache must match what
    // it draws when it looks every glyph up again.
    const shown = snapshot(b.term);
    expect(differingPixels(shown, fromScratch(b.term))).toBe(0);
  });

  it("the pane that lost its context draws its text correctly after the reload", { timeout: 20_000 }, async () => {
    // What PR #38 set out to guarantee, checked on pixels instead of on a spy.
    const textA = "the quick brown fox jumps over the lazy dog";
    const a = await openPane(textA);
    await openPane("pack my box with five dozen liquor jugs");
    await nextFrame();
    await nextFrame();

    await loseContextAndRefocus(a.term);
    await nextFrame();

    const shown = snapshot(a.term);
    expect(differingPixels(shown, fromScratch(a.term))).toBe(0);
    // And the text is actually there, not blank cells.
    expect(inkPixels(shown)).toBeGreaterThan(200);
  });
});
