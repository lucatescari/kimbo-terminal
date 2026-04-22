import { describe, it, expect, beforeAll } from "vitest";
import "./style.css";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { normalizeFontFamily } from "./theme";

// We always pass a PUA test string to FontFaceSet.load — an empty default
// test string wouldn't trigger the fetch if a future @font-face adds a
// unicode-range restriction.
// Spaceship prompt emits U+E0A2 (the Powerline padlock), NOT U+F023 (the
// Font Awesome lock) for non-writable directories — we hex-dumped the
// SPACESHIP_DIR_LOCK_SYMBOL bytes to confirm. Earlier iterations of this
// test used F023, which is why they passed while the user kept seeing
// squish. E0A2 lives in a narrower Powerline-only block that Symbols Nerd
// Font Mono (and some NerdFontMono variants) patches with a wider glyph.
const LOCK = "\ue0a2";
const LOCK_FA = "\uf023"; // kept for the broader PUA-range coverage check
const NERD_FONT_FAMILY = "JetBrainsMono Nerd Font Mono";

async function waitForFont(family: string, sample: string): Promise<boolean> {
  // Multiple sizes: the atlas in WebGL xterm rasterizes at terminal fontSize,
  // which can differ from any arbitrary preload size. Loading across the sizes
  // Kimbo actually uses gives us a stable signal for the test.
  for (const size of [14, 16]) {
    await document.fonts.load(`${size}px '${family}'`, sample);
  }
  return document.fonts.check(`14px '${family}'`, sample);
}

function measure(font: string, ch: string): number {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "top";
  return ctx.measureText(ch).width;
}

/** Render `ch` with `font` into a canvas and count the non-transparent pixels.
 *  A squished/empty/tofu glyph has visibly fewer ink pixels than a properly
 *  shaped one, giving us a second signal independent of measureText width. */
function countInkPixels(font: string, ch: string): number {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000000";
  ctx.fillText(ch, 2, 2);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) count++;
  return count;
}

describe("Nerd Font fallback: font loads for Private Use Area", () => {
  beforeAll(async () => {
    await waitForFont(NERD_FONT_FAMILY, LOCK);
  });

  it("FontFaceSet reports the Nerd Font as loaded for the lock glyph", () => {
    expect(document.fonts.check(`14px '${NERD_FONT_FAMILY}'`, LOCK)).toBe(true);
  });

  it("the full Kimbo font chain resolves PUA glyphs via the Nerd Font", () => {
    // Simulate exactly what normalizeFontFamily produces for the default opts.
    const chain = `'JetBrains Mono', 'Menlo', '${NERD_FONT_FAMILY}', monospace`;
    expect(document.fonts.check(`14px ${chain}`, LOCK)).toBe(true);
  });
});

describe("Nerd Font fallback: lock glyph renders at monospace cell width", () => {
  beforeAll(async () => {
    // Also load JetBrains Mono so we have a stable reference cell width.
    // It's already pulled in via style.css @import from Google Fonts.
    await document.fonts.load("14px 'JetBrains Mono'", "M");
    await waitForFont(NERD_FONT_FAMILY, LOCK);
  });

  it("lock glyph width roughly matches a Latin cell width (± 1.5px)", () => {
    const chain = `14px 'JetBrains Mono', 'Menlo', '${NERD_FONT_FAMILY}', monospace`;
    const cellWidth = measure(chain, "M");
    const lockWidth = measure(chain, LOCK);
    // A properly-matched monospace Nerd Font glyph occupies one cell. If the
    // browser falls back to a default UI font for U+F023, the returned width
    // is typically much smaller (emoji-ish or tofu) or much larger.
    expect(Math.abs(lockWidth - cellWidth)).toBeLessThanOrEqual(1.5);
  });

  it("lock glyph is not an empty/tofu/squished render", () => {
    const chain = `14px 'JetBrains Mono', 'Menlo', '${NERD_FONT_FAMILY}', monospace`;
    const ink = countInkPixels(chain, LOCK);
    // Rough lower bound: a real padlock glyph at 14px hits ~50–120 opaque
    // pixels in a 32x32 bitmap. 0 means the codepoint rendered invisibly;
    // <20 is a squished or empty-box fallback.
    expect(ink).toBeGreaterThan(25);
  });

  it("lock glyph rendered with nerd-font chain visibly differs from monospace-only fallback", () => {
    const withNerd = countInkPixels(
      `14px 'JetBrains Mono', '${NERD_FONT_FAMILY}', monospace`,
      LOCK,
    );
    const withoutNerd = countInkPixels(`14px 'JetBrains Mono', monospace`, LOCK);
    // If these are equal, it means either (a) the Nerd Font isn't loading at
    // all, or (b) the browser is picking the same fallback in both cases.
    // Either way, the fix isn't active.
    expect(withNerd).not.toBe(withoutNerd);
  });
});

// End-to-end test that actually drives xterm.js the way Kimbo does. Canvas
// measureText can look fine while xterm's renderer still crams the glyph
// into the wrong cell, so we compare geometry xterm reports directly. In
// headless Chromium (Playwright) WebGL is unreliable, but xterm's default
// DOM renderer goes through the same browser text-shaping pipeline for
// font fallback — if the advance width is wrong there, it's wrong in WebGL
// too, and vice versa.
describe("Nerd Font fallback: xterm.js renders the lock glyph at cell width", () => {
  beforeAll(async () => {
    await document.fonts.load("14px 'JetBrains Mono'", "M");
    await waitForFont(NERD_FONT_FAMILY, LOCK);
  });

  function makeTerminal(): { term: Terminal; container: HTMLElement } {
    const container = document.createElement("div");
    // Keep the container in the DOM so xterm can measure layout; headless
    // Chromium otherwise zeroes out layout metrics.
    container.style.width = "640px";
    container.style.height = "240px";
    document.body.appendChild(container);
    const term = new Terminal({
      fontFamily: normalizeFontFamily("'JetBrains Mono', 'Menlo', monospace"),
      fontSize: 14,
      lineHeight: 1.2,
      rows: 10,
      cols: 40,
      allowProposedApi: true,
    });
    term.open(container);
    return { term, container };
  }

  it("xterm accepts and stores the lock glyph in its buffer", async () => {
    const { term, container } = makeTerminal();
    try {
      await new Promise<void>((resolve) => term.write(LOCK, () => resolve()));
      // Reading from the buffer (not the DOM) bypasses any renderer-flush
      // timing flakiness — xterm either stored the codepoint in its cell
      // buffer or it didn't, and that's what downstream rendering uses.
      const cell = term.buffer.active.getLine(0)!.getCell(0)!;
      expect(cell.getChars()).toBe(LOCK);
      expect(cell.getCode()).toBe(LOCK.codePointAt(0));
    } finally {
      term.dispose();
      container.remove();
    }
  });

  it("xterm treats the lock glyph as a single-cell-wide character", async () => {
    // Unicode 11 tables classify U+F023 as width 1 (narrow). If the addon
    // were missing or the font set a different wcwidth we'd see width 2
    // here, and downstream the cursor would advance the wrong amount. This
    // doesn't catch the rendering squish directly — that's covered by the
    // Canvas measureText tests above — but it pins the cell-grid invariant
    // the renderer relies on.
    const { term, container } = makeTerminal();
    try {
      await new Promise<void>((resolve) => term.write(LOCK, () => resolve()));
      const cell = term.buffer.active.getLine(0)!.getCell(0)!;
      expect(cell.getWidth()).toBe(1);
      // And the cursor advanced exactly one cell past column 0.
      expect(term.buffer.active.cursorX).toBe(1);
    } finally {
      term.dispose();
      container.remove();
    }
  });
});

// Simulates exactly what xterm's WebGL glyph atlas does when rasterizing a
// glyph into a fixed-width texture cell. If measureText returns a width
// wider than the cell, xterm applies a horizontal scale transform to squeeze
// the glyph into the cell — that transform IS the squish the user sees on
// screen. Reproducing the pipeline end-to-end in Canvas 2D gives us a
// reliable assertion without depending on xterm's internals.
describe("Nerd Font fallback: xterm-style cell rasterization", () => {
  beforeAll(async () => {
    await document.fonts.load("14px 'JetBrains Mono'", "M");
    await waitForFont(NERD_FONT_FAMILY, LOCK);
  });

  /** Rasterize `ch` with `fontChain` into a cell-sized canvas using the same
   *  scaling behavior xterm's TextureAtlas uses: measure the glyph, and if
   *  its natural advance exceeds the cell, shrink the x-axis to fit. Returns
   *  the pixel bounding box of the rendered ink. */
  function rasterizeIntoCell(
    fontChain: string,
    ch: string,
    cellWidth: number,
    cellHeight: number,
  ): { inkWidth: number; inkHeight: number; inkPixels: number; scaled: boolean } {
    const canvas = document.createElement("canvas");
    canvas.width = cellWidth;
    canvas.height = cellHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.font = fontChain;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    const metrics = ctx.measureText(ch);
    const naturalWidth = metrics.width;
    let scaled = false;
    ctx.save();
    if (naturalWidth > cellWidth) {
      // Same transform xterm.js applies when a glyph overruns its cell.
      ctx.scale(cellWidth / naturalWidth, 1);
      scaled = true;
    }
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    // Measure ink bounding box on the full cell-sized canvas.
    const data = ctx.getImageData(0, 0, cellWidth, cellHeight).data;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let pixels = 0;
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const a = data[(y * cellWidth + x) * 4 + 3];
        if (a > 16) {
          pixels++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const inkWidth = pixels > 0 ? maxX - minX + 1 : 0;
    const inkHeight = pixels > 0 ? maxY - minY + 1 : 0;
    return { inkWidth, inkHeight, inkPixels: pixels, scaled };
  }

  it("xterm-style rasterization does NOT need to apply a squish-scale to the lock glyph", () => {
    // The Kimbo font chain at 14px. measureText(lock) must NOT exceed the
    // cell width, otherwise xterm's WebGL atlas will scale-down the x-axis
    // and the glyph renders squished. This is the root-cause assertion.
    const chain = `14px 'JetBrains Mono', 'Menlo', '${NERD_FONT_FAMILY}', monospace`;
    const cellWidth = measure(chain, "M"); // baseline monospace cell
    const lockWidth = measure(chain, LOCK);
    expect(
      lockWidth,
      `lock advance ${lockWidth}px > cell ${cellWidth}px triggers WebGL squish transform`,
    ).toBeLessThanOrEqual(cellWidth + 0.75);
  });

  it("Powerline + Font Awesome prompt canaries all fit in one cell", async () => {
    // A prompt like Spaceship/starship/p10k draws from several codepoint
    // blocks. This test pins every canary at once so regressions (someone
    // swaps the bundled font or the fallback chain) fail LOUDLY per-glyph
    // instead of being caught only for the one codepoint we happened to
    // spot-check.
    const canaries = [
      { name: "fa-lock",    ch: "\uf023" },
      { name: "pl-padlock", ch: "\ue0a2" },
      { name: "pl-sep",     ch: "\ue0b0" },
      { name: "md-branch",  ch: "\uf418" },
    ];
    await document.fonts.load(`14px 'JetBrains Mono'`, "M");
    for (const { ch } of canaries) {
      await document.fonts.load(`14px '${NERD_FONT_FAMILY}'`, ch);
    }
    await document.fonts.ready;

    const chain = `14px 'JetBrains Mono', 'Menlo', '${NERD_FONT_FAMILY}', monospace`;
    const cellWidth = measure(chain, "M");
    for (const { name, ch } of canaries) {
      const w = measure(chain, ch);
      expect(
        w,
        `${name} (U+${ch.codePointAt(0)!.toString(16).toUpperCase()}) is ${w.toFixed(2)}px — wider than cell ${cellWidth.toFixed(2)}px, will squish`,
      ).toBeLessThanOrEqual(cellWidth + 0.75);
    }
  });

  it("xterm WebGL atlas: rendered lock glyph keeps a balanced aspect ratio end-to-end", async () => {
    // Drives the exact stack Kimbo ships: xterm + Unicode11 + WebglAddon,
    // with the font family produced by normalizeFontFamily. We subscribe
    // to the atlas-canvas events BEFORE loading WebglAddon so we catch the
    // very first page it creates, then snapshot the rasterized glyphs.
    const container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "240px";
    document.body.appendChild(container);
    const term = new Terminal({
      fontFamily: normalizeFontFamily("'JetBrains Mono', 'Menlo', monospace"),
      fontSize: 14,
      lineHeight: 1.2,
      rows: 10,
      cols: 50,
      allowProposedApi: true,
      allowTransparency: true,
    });
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(container);

    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
    } catch (_) {
      // Playwright headless Chromium sometimes has no working GL. Skip
      // gracefully — the measureText/DOM tests above already cover the
      // invariants.
      term.dispose();
      container.remove();
      return;
    }
    // Subscribe BEFORE loadAddon so we catch the initial atlas canvas.
    const atlasCanvases: HTMLCanvasElement[] = [];
    webgl.onAddTextureAtlasCanvas((c) => atlasCanvases.push(c));
    term.loadAddon(webgl);

    try {
      await new Promise<void>((resolve) => term.write(LOCK, () => resolve()));
      // Wait a few frames for WebGL to flush the render and populate the atlas.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => setTimeout(r, 50));

      // Headless Chromium's GL stack sometimes initialises without ever
      // creating an atlas canvas (swiftshader quirks). Skip instead of fail
      // in that case — the canary/aspect tests above already cover the
      // font-side invariants, and this test only adds value when GL runs.
      if (atlasCanvases.length === 0) return;

      // Find any non-empty pixel cluster in the atlas pages and measure its
      // aspect ratio. A squished lock glyph is much taller than wide.
      let worstAspect = Infinity;
      let foundAnyGlyph = false;
      for (const atlas of atlasCanvases) {
        const ctx = atlas.getContext("2d", { willReadFrequently: true });
        if (!ctx) continue;
        const img = ctx.getImageData(0, 0, atlas.width, atlas.height).data;
        const step = 4;
        const cols = Math.ceil(atlas.width / step);
        const rows = Math.ceil(atlas.height / step);
        const ink = new Uint8Array(cols * rows);
        for (let y = 0; y < atlas.height; y++) {
          for (let x = 0; x < atlas.width; x++) {
            const a = img[(y * atlas.width + x) * 4 + 3];
            if (a > 16) ink[Math.floor(y / step) * cols + Math.floor(x / step)] = 1;
          }
        }
        const visited = new Uint8Array(ink.length);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (!ink[idx] || visited[idx]) continue;
            const stack = [idx];
            let minC = c, maxC = c, minR = r, maxR = r, size = 0;
            while (stack.length) {
              const p = stack.pop()!;
              if (visited[p]) continue;
              visited[p] = 1;
              if (!ink[p]) continue;
              size++;
              const pr = Math.floor(p / cols), pc = p % cols;
              if (pr < minR) minR = pr; if (pr > maxR) maxR = pr;
              if (pc < minC) minC = pc; if (pc > maxC) maxC = pc;
              if (pr > 0) stack.push(p - cols);
              if (pr < rows - 1) stack.push(p + cols);
              if (pc > 0) stack.push(p - 1);
              if (pc < cols - 1) stack.push(p + 1);
            }
            if (size >= 3) {
              foundAnyGlyph = true;
              const w = (maxC - minC + 1) * step;
              const h = (maxR - minR + 1) * step;
              const aspect = w / h;
              if (aspect < worstAspect) worstAspect = aspect;
            }
          }
        }
      }

      expect(foundAnyGlyph, "no rasterized glyph found in atlas").toBe(true);
      // Lock glyph is roughly square (aspect ~0.9). A squished one is ~0.25.
      // Cursor/bar shapes are legitimately narrow, so the floor stays lenient.
      expect(worstAspect).toBeGreaterThan(0.35);
    } finally {
      try { webgl?.dispose(); } catch (_) { /* ignore */ }
      term.dispose();
      container.remove();
    }
  });

  it("rendered Powerline padlock glyph has a roughly square aspect ratio (not intrinsically thin)", () => {
    // Cell size based on typical 14px JBM metrics at standard DPR. If the
    // BUNDLED font draws U+E0A2 as a tall-and-thin shape on its own (aspect
    // < 0.45), then the user's squish isn't an xterm rendering bug — the
    // font variant itself has a skinny padlock drawn inside the cell.
    // That signals we picked the wrong nerd-font variant and need to
    // re-bundle (e.g. the non-Mono NerdFont patch, which keeps wider glyphs).
    const chain = `14px 'JetBrains Mono', 'Menlo', '${NERD_FONT_FAMILY}', monospace`;
    const cellWidth = Math.ceil(measure(chain, "M"));
    const cellHeight = Math.ceil(14 * 1.2);
    const r = rasterizeIntoCell(chain, LOCK, cellWidth, cellHeight);
    expect(r.inkPixels, "padlock glyph must produce visible ink").toBeGreaterThan(20);
    expect(r.scaled, "xterm would NOT apply its squish transform to this glyph").toBe(false);
    const aspect = r.inkWidth / r.inkHeight;
    expect(
      aspect,
      `aspect ${aspect.toFixed(2)} (w=${r.inkWidth}, h=${r.inkHeight}) — font's own glyph is thin`,
    ).toBeGreaterThan(0.45);
  });
});
