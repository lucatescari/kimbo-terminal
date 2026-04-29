import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const source = readFileSync(resolve(__dirname, "osc1337-renderer.ts"), "utf-8");

describe("osc1337-renderer module surface", () => {
  it("exports attachOsc1337Renderer", () => {
    expect(source).toMatch(/export function attachOsc1337Renderer/);
  });

  it("registers the OSC 1337 handler", () => {
    expect(source).toMatch(/registerOscHandler\s*\(\s*1337/);
  });

  it("returns a dispose function", () => {
    expect(source).toMatch(/return\s+(?:function\s+dispose|\(\s*\)\s*=>)/);
  });

  it("imports the pure parser from osc1337", () => {
    expect(source).toMatch(/from\s+["']\.\/osc1337["']/);
  });

  it("writes textual fallback markers", () => {
    expect(source).toContain("[inline image:");
  });
});

describe("osc1337-renderer uses xterm decorations for anchoring", () => {
  it("registers a decoration per image via term.registerDecoration", () => {
    // Anchoring is delegated to xterm's decoration API so it handles
    // scroll/resize/clip itself — we stopped hand-rolling an overlay with
    // repositionAll + onScroll + ResizeObserver because it kept drifting
    // out of sync with the real renderer.
    expect(source).toMatch(/term\.registerDecoration\s*\(/);
  });

  it("sizes the decoration in cells (width, height)", () => {
    expect(source).toMatch(/width\s*:\s*widthCells/);
    expect(source).toMatch(/height\s*:\s*heightCells/);
  });

  it("passes the marker and captured column to the decoration", () => {
    expect(source).toMatch(/marker\s*,[\s\S]{0,40}x\s*:\s*markerColumn/);
  });

  it("appends the <img> to the decoration element via onRender", () => {
    expect(source).toMatch(/decoration\.onRender/);
    expect(source).toMatch(/el\.appendChild\s*\(\s*img\s*\)/);
  });

  it("appends exactly once per decoration (guards re-render callbacks)", () => {
    // xterm fires onRender every time the decoration is repositioned.
    // Appending on every call would clone the image and leak blob refs.
    expect(source).toMatch(/appended\s*=\s*true/);
  });

  it("registers the decoration on the top layer so it clears the selection layer", () => {
    expect(source).toMatch(/layer\s*:\s*["']top["']/);
  });

  it("revokes the blob URL when the decoration disposes", () => {
    expect(source).toMatch(/decoration\.onDispose[\s\S]{0,120}revokeObjectURL/);
  });

  it("no longer hand-rolls repositioning (onScroll/onWriteParsed/ResizeObserver)", () => {
    // These signal the old overlay approach. They're xterm's job now.
    expect(source).not.toMatch(/term\.onScroll/);
    expect(source).not.toMatch(/onWriteParsed/);
    expect(source).not.toMatch(/ResizeObserver/);
    expect(source).not.toMatch(/repositionAll/);
    expect(source).not.toMatch(/cachedRowOrigin/);
  });
});

describe("osc1337-renderer bitmap pipeline", () => {
  it("calls decodeBase64Bytes with max cap", () => {
    expect(source).toMatch(/decodeBase64Bytes\s*\(/);
    expect(source).toMatch(/10\s*\*\s*1024\s*\*\s*1024/);
  });

  it("calls sniffBitmapFormat on the decoded bytes", () => {
    expect(source).toMatch(/sniffBitmapFormat\s*\(/);
  });

  it("calls resolveImageLayout before reserving rows", () => {
    expect(source).toMatch(/resolveImageLayout\s*\(/);
  });

  it("registers a marker at current cursor line", () => {
    expect(source).toMatch(/registerMarker\s*\(\s*0\s*\)/);
  });

  it("creates a blob URL and img element", () => {
    expect(source).toMatch(/createObjectURL/);
    expect(source).toMatch(/document\.createElement\(["']img["']\)/);
  });

  it("only renders when inline flag is true", () => {
    expect(source).toMatch(/!parsed\.inline/);
  });

  it("anchors the decoration column using the captured cursor column", () => {
    // The column must be snapshotted synchronously at OSC arrival so the
    // decoration column is the spot fastfetch/imgcat emitted the image,
    // even if later bytes in the same parser chunk move the cursor.
    const handlerStart = source.indexOf("const oscHandler");
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerBody = source.slice(handlerStart);
    const cursorXIdx = handlerBody.search(/term\.buffer\.active\.cursorX/);
    const registerIdx = handlerBody.search(/term\.registerMarker/);
    expect(cursorXIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeGreaterThan(-1);
    expect(cursorXIdx).toBeLessThan(registerIdx);
  });

  it("never writes a cursor save/restore placeholder block", () => {
    // Writing `\x1b7[spaces]\x1b8` from inside the OSC handler queues it
    // onto xterm's WriteBuffer, which runs the chunk *after* the rest of
    // the current chunk finishes — so the block overwrites whatever the
    // app printed next (prompt text, the next line of fastfetch info).
    // Apps handle their own cursor layout (fastfetch wraps its own
    // ESC[s/ESC[u); we must not.
    expect(source).not.toMatch(/\\x1b7/);
    expect(source).not.toMatch(/\\x1b8/);
  });
});

describe("osc1337-renderer cell measurement", () => {
  it("reads cell dimensions from xterm's render service (works for WebGL and DOM)", () => {
    // The decoration API positions its element in pixels using xterm's
    // internal cell dims; we use the same source for layout math so our
    // <img>'s pxWidth/pxHeight stays aligned with the decoration box.
    expect(source).toMatch(/_core\?\._renderService/);
    expect(source).toMatch(/dimensions\?\.css\?\.cell/);
  });
});
