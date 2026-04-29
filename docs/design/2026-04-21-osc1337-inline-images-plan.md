# OSC 1337 Inline Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render iTerm2 OSC 1337 inline images inside Kimbo's xterm.js panes, replacing the phase-1 text marker with actual bitmap rendering that flows with the scrollback buffer.

**Architecture:** Three-module split. `osc1337.ts` stays pure (parsing, format sniffing, base64 decode, layout math). A new `osc1337-renderer.ts` owns all DOM + xterm-marker lifecycle. `terminal.ts` shrinks to a 3-line wiring call. Follows the existing codebase convention (see `osc8.ts` `clipLinkRangeForLine`): extract pure logic for unit tests; keep DOM-touching code thin and covered by source-inspection + manual smoke.

**Tech Stack:** TypeScript, vitest + jsdom, `@xterm/xterm` 5.5, Tauri `plugin-opener` for Cmd-click.

**Spec:** `docs/design/2026-04-21-osc1337-inline-images.md`

---

## File touch list

| File | Change |
|---|---|
| `src-ui/osc1337.ts` | Extend: add `sniffBitmapFormat`, `decodeBase64Bytes`, `resolveImageLayout`, `computeOverlayTop` |
| `src-ui/osc1337.test.ts` | Extend: unit tests for the four new helpers |
| `src-ui/osc1337-renderer.ts` | **New.** Owns DOM overlay + xterm marker lifecycle |
| `src-ui/osc1337-renderer.test.ts` | **New.** Source-inspection tests (registration, dispose wiring) |
| `src-ui/terminal.ts` | Replace lines 150–158 (inline OSC handler) with `attachOsc1337Renderer` call; hook dispose |
| `src-ui/kimbo.css` | Add one rule for `.kimbo-osc1337-overlay` container |

No Rust / no Tauri plugin changes.

---

## Task 1: Format sniffing (`sniffBitmapFormat`)

**Files:**
- Modify: `src-ui/osc1337.ts` (append export)
- Test: `src-ui/osc1337.test.ts` (append new `describe` block)

- [ ] **Step 1.1: Write the failing tests**

Append to `src-ui/osc1337.test.ts`:

```typescript
import { sniffBitmapFormat } from "./osc1337";

describe("sniffBitmapFormat", () => {
  it("identifies PNG by magic bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffBitmapFormat(png)).toBe("png");
  });

  it("identifies JPEG by magic bytes", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffBitmapFormat(jpg)).toBe("jpeg");
  });

  it("identifies GIF87a and GIF89a", () => {
    const gif87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0]);
    const gif89 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    expect(sniffBitmapFormat(gif87)).toBe("gif");
    expect(sniffBitmapFormat(gif89)).toBe("gif");
  });

  it("identifies WebP (RIFF....WEBP)", () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0, 0,
    ]);
    expect(sniffBitmapFormat(webp)).toBe("webp");
  });

  it("rejects SVG (starts with '<')", () => {
    const svg = new TextEncoder().encode("<svg xmlns=");
    expect(sniffBitmapFormat(svg)).toBeNull();
  });

  it("rejects unknown bytes", () => {
    expect(sniffBitmapFormat(new Uint8Array([0, 1, 2, 3, 4]))).toBeNull();
  });

  it("rejects empty input", () => {
    expect(sniffBitmapFormat(new Uint8Array([]))).toBeNull();
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337.test.ts`
Expected: FAIL with `sniffBitmapFormat is not a function` (or equivalent import error).

- [ ] **Step 1.3: Implement `sniffBitmapFormat`**

Append to `src-ui/osc1337.ts`:

```typescript
export type BitmapFormat = "png" | "jpeg" | "gif" | "webp";

/** Identify bitmap format by magic bytes. Returns null for anything that
 *  isn't PNG/JPEG/GIF/WebP (including SVG — which is rejected on purpose:
 *  SVG can embed <script> and external fetches, so it must never be
 *  rendered from PTY-sourced content). */
export function sniffBitmapFormat(bytes: Uint8Array): BitmapFormat | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "gif";
  // WebP: "RIFF" ???? "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  return null;
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337.test.ts`
Expected: all tests in `sniffBitmapFormat` describe pass.

- [ ] **Step 1.5: Commit**

```bash
git add src-ui/osc1337.ts src-ui/osc1337.test.ts
git commit -m "feat(osc1337): sniff PNG/JPEG/GIF/WebP by magic bytes, reject SVG"
```

---

## Task 2: Bounded base64 decode (`decodeBase64Bytes`)

**Files:**
- Modify: `src-ui/osc1337.ts`
- Test: `src-ui/osc1337.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Append to `src-ui/osc1337.test.ts`:

```typescript
import { decodeBase64Bytes } from "./osc1337";

describe("decodeBase64Bytes", () => {
  it("decodes valid base64 to Uint8Array", () => {
    // "abcd" base64 = "YWJjZA=="
    const out = decodeBase64Bytes("YWJjZA==", 1024);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([97, 98, 99, 100]);
  });

  it("returns null when decoded size exceeds maxBytes", () => {
    // 8 base64 chars => 6 bytes decoded; cap at 5 → reject
    expect(decodeBase64Bytes("YWJjZGVm", 5)).toBeNull();
  });

  it("returns null for invalid base64", () => {
    expect(decodeBase64Bytes("!!!not-base64!!!", 1024)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(decodeBase64Bytes("", 1024)).toBeNull();
  });

  it("tolerates whitespace in payload", () => {
    const out = decodeBase64Bytes("YWJj\n  ZA==", 1024);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(4);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337.test.ts -t "decodeBase64Bytes"`
Expected: FAIL with import error.

- [ ] **Step 2.3: Implement `decodeBase64Bytes`**

Append to `src-ui/osc1337.ts`:

```typescript
/** Decode a base64 string to a Uint8Array, rejecting inputs whose decoded
 *  size would exceed `maxBytes` and inputs that aren't valid base64.
 *  Pre-estimates size from length so we can reject a 1 GB payload before
 *  allocating anything. Tolerates whitespace (OSC payloads sometimes
 *  arrive line-wrapped). */
export function decodeBase64Bytes(data: string, maxBytes: number): Uint8Array | null {
  if (!data) return null;
  const sanitized = data.replace(/\s+/g, "");
  if (!sanitized) return null;
  const estimated = estimateBase64Bytes(sanitized);
  if (estimated == null || estimated > maxBytes) return null;
  try {
    const binary = atob(sanitized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
```

Note: `estimateBase64Bytes` already exists in `osc1337.ts`; reuse it.

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337.test.ts -t "decodeBase64Bytes"`
Expected: all pass.

- [ ] **Step 2.5: Commit**

```bash
git add src-ui/osc1337.ts src-ui/osc1337.test.ts
git commit -m "feat(osc1337): bounded base64 decoder with size cap"
```

---

## Task 3: Layout resolution (`resolveImageLayout`)

This is the arithmetic core of the feature — pure, easy to test, easy to get wrong if not tested thoroughly.

**Files:**
- Modify: `src-ui/osc1337.ts`
- Test: `src-ui/osc1337.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Append to `src-ui/osc1337.test.ts`:

```typescript
import { resolveImageLayout } from "./osc1337";

describe("resolveImageLayout", () => {
  // Shared test fixtures — typical Kimbo cell size, viewport, and 200x100 image.
  const cell = { width: 8, height: 16 };
  const viewport = { width: 800, height: 600 };
  const natural = { width: 200, height: 100 };

  it("resolves auto/auto to natural size, clamped to viewport width", () => {
    const out = resolveImageLayout(
      { width: "auto", height: "auto", preserveAspectRatio: true },
      natural, cell, viewport,
    );
    expect(out).toEqual({ pxWidth: 200, pxHeight: 100, rowsToReserve: 7 });
    // rowsToReserve = ceil(100 / 16) = 7
  });

  it("resolves cells (integer units)", () => {
    const out = resolveImageLayout(
      { width: "10", height: "5", preserveAspectRatio: false },
      natural, cell, viewport,
    );
    expect(out.pxWidth).toBe(80);  // 10 cells * 8 px
    expect(out.pxHeight).toBe(80); // 5 cells * 16 px
    expect(out.rowsToReserve).toBe(5);
  });

  it("resolves Npx literal pixels", () => {
    const out = resolveImageLayout(
      { width: "400px", height: "200px", preserveAspectRatio: false },
      natural, cell, viewport,
    );
    expect(out.pxWidth).toBe(400);
    expect(out.pxHeight).toBe(200);
  });

  it("resolves N% against viewport", () => {
    const out = resolveImageLayout(
      { width: "50%", height: "auto", preserveAspectRatio: true },
      natural, cell, viewport,
    );
    expect(out.pxWidth).toBe(400); // 50% of 800
    expect(out.pxHeight).toBe(200); // preserved ratio: 400 * (100/200)
  });

  it("preserves aspect ratio when only one dim given", () => {
    const out = resolveImageLayout(
      { width: "100px", height: "auto", preserveAspectRatio: true },
      natural, cell, viewport,
    );
    expect(out.pxWidth).toBe(100);
    expect(out.pxHeight).toBe(50);
  });

  it("fit-inside (letterbox) when both dims given and preserveAspectRatio", () => {
    // Image is 200x100 (2:1). Box is 400x400 (1:1). Fit-inside => 400x200.
    const out = resolveImageLayout(
      { width: "400px", height: "400px", preserveAspectRatio: true },
      natural, cell, viewport,
    );
    expect(out.pxWidth).toBe(400);
    expect(out.pxHeight).toBe(200);
  });

  it("clamps width to viewport", () => {
    const out = resolveImageLayout(
      { width: "2000px", height: "auto", preserveAspectRatio: true },
      natural, cell, viewport,
    );
    expect(out.pxWidth).toBe(800); // clamped
    expect(out.pxHeight).toBe(400); // preserved ratio
  });

  it("clamps height to MAX_DIM (4096)", () => {
    const tall = { width: 100, height: 10000 };
    const out = resolveImageLayout(
      { width: "auto", height: "auto", preserveAspectRatio: true },
      tall, cell, viewport,
    );
    expect(out.pxHeight).toBeLessThanOrEqual(4096);
  });

  it("never scales up past natural size", () => {
    const tiny = { width: 10, height: 10 };
    const out = resolveImageLayout(
      { width: "500px", height: "500px", preserveAspectRatio: true },
      tiny, cell, viewport,
    );
    expect(out.pxWidth).toBe(10);
    expect(out.pxHeight).toBe(10);
  });

  it("rowsToReserve is ceil(pxHeight / cellHeight)", () => {
    const out = resolveImageLayout(
      { width: "auto", height: "33px", preserveAspectRatio: false },
      natural, cell, viewport,
    );
    expect(out.pxHeight).toBe(33);
    expect(out.rowsToReserve).toBe(3); // ceil(33 / 16)
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337.test.ts -t "resolveImageLayout"`
Expected: FAIL with import error.

- [ ] **Step 3.3: Implement `resolveImageLayout`**

Append to `src-ui/osc1337.ts`:

```typescript
export interface LayoutAttrs {
  width: string | null;
  height: string | null;
  preserveAspectRatio: boolean;
}

export interface ResolvedLayout {
  pxWidth: number;
  pxHeight: number;
  rowsToReserve: number;
}

const MAX_DIM = 4096;

/** Resolve OSC 1337 width/height attrs (cells, Npx, N%, auto) into actual
 *  pixel dimensions plus the number of terminal rows the image should
 *  occupy in the buffer. Pure function — all measurements are supplied by
 *  the caller so this is unit-testable without a DOM. */
export function resolveImageLayout(
  attrs: LayoutAttrs,
  natural: { width: number; height: number },
  cell: { width: number; height: number },
  viewport: { width: number; height: number },
): ResolvedLayout {
  const wAxis = { unitCell: cell.width, unitViewport: viewport.width, natural: natural.width };
  const hAxis = { unitCell: cell.height, unitViewport: viewport.height, natural: natural.height };

  const w = resolveAxis(attrs.width, wAxis);
  const h = resolveAxis(attrs.height, hAxis);

  let pxWidth: number;
  let pxHeight: number;
  const aspect = natural.width / natural.height;

  if (w != null && h != null) {
    if (attrs.preserveAspectRatio) {
      // Fit-inside: scale so neither dim exceeds, never distort.
      const scale = Math.min(w / natural.width, h / natural.height);
      pxWidth = natural.width * scale;
      pxHeight = natural.height * scale;
    } else {
      pxWidth = w;
      pxHeight = h;
    }
  } else if (w != null) {
    pxWidth = w;
    pxHeight = attrs.preserveAspectRatio ? w / aspect : natural.height;
  } else if (h != null) {
    pxHeight = h;
    pxWidth = attrs.preserveAspectRatio ? h * aspect : natural.width;
  } else {
    pxWidth = natural.width;
    pxHeight = natural.height;
  }

  // Never scale up past natural size.
  if (pxWidth > natural.width || pxHeight > natural.height) {
    const downscale = Math.min(natural.width / pxWidth, natural.height / pxHeight);
    pxWidth *= downscale;
    pxHeight *= downscale;
  }

  // Clamp to viewport width (keeping aspect).
  if (pxWidth > viewport.width) {
    const scale = viewport.width / pxWidth;
    pxWidth = viewport.width;
    pxHeight *= scale;
  }

  // Clamp to MAX_DIM (keeping aspect).
  if (pxHeight > MAX_DIM) {
    const scale = MAX_DIM / pxHeight;
    pxHeight = MAX_DIM;
    pxWidth *= scale;
  }

  pxWidth = Math.round(pxWidth);
  pxHeight = Math.round(pxHeight);

  return {
    pxWidth,
    pxHeight,
    rowsToReserve: Math.max(1, Math.ceil(pxHeight / cell.height)),
  };
}

function resolveAxis(
  value: string | null,
  axis: { unitCell: number; unitViewport: number; natural: number },
): number | null {
  if (value == null || value === "" || value === "auto") return null;
  if (value.endsWith("px")) {
    const n = Number(value.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (value.endsWith("%")) {
    const n = Number(value.slice(0, -1));
    return Number.isFinite(n) ? (n / 100) * axis.unitViewport : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n * axis.unitCell : null;
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337.test.ts -t "resolveImageLayout"`
Expected: all pass.

- [ ] **Step 3.5: Commit**

```bash
git add src-ui/osc1337.ts src-ui/osc1337.test.ts
git commit -m "feat(osc1337): pure layout resolver for cells/px/%/auto"
```

---

## Task 4: Overlay top computation (`computeOverlayTop`)

The one piece of DOM-positioning math we can extract for tests. Takes marker line + viewport scroll + cell height → the `top` pixel offset the `<img>` needs.

**Files:**
- Modify: `src-ui/osc1337.ts`
- Test: `src-ui/osc1337.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Append to `src-ui/osc1337.test.ts`:

```typescript
import { computeOverlayTop } from "./osc1337";

describe("computeOverlayTop", () => {
  const cell = { width: 8, height: 16 };

  it("returns top=0 when marker is at the first visible row", () => {
    // markerAbsoluteLine = 10, viewportFirstLine = 10 → offset 0 rows → 0 px
    expect(computeOverlayTop({ markerLine: 10, viewportTop: 10 }, cell)).toBe(0);
  });

  it("returns positive top when marker is below the viewport top", () => {
    // 5 rows below → 80 px
    expect(computeOverlayTop({ markerLine: 15, viewportTop: 10 }, cell)).toBe(80);
  });

  it("returns negative top when marker has scrolled above the viewport", () => {
    // 3 rows above → -48 px
    expect(computeOverlayTop({ markerLine: 7, viewportTop: 10 }, cell)).toBe(-48);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337.test.ts -t "computeOverlayTop"`
Expected: FAIL with import error.

- [ ] **Step 4.3: Implement `computeOverlayTop`**

Append to `src-ui/osc1337.ts`:

```typescript
/** Given a marker's absolute buffer line and the buffer line of the first
 *  visible row in the viewport, return the pixel offset (from the top of
 *  the viewport) where the image overlay should sit. Negative values mean
 *  the image has scrolled above the viewport; CSS clipping handles that. */
export function computeOverlayTop(
  args: { markerLine: number; viewportTop: number },
  cell: { width: number; height: number },
): number {
  return (args.markerLine - args.viewportTop) * cell.height;
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337.test.ts -t "computeOverlayTop"`
Expected: all pass.

- [ ] **Step 4.5: Commit**

```bash
git add src-ui/osc1337.ts src-ui/osc1337.test.ts
git commit -m "feat(osc1337): pure overlay-top computation for scroll sync"
```

---

## Task 5: Renderer module skeleton

Create the renderer file with just the OSC handler wiring and text-marker fallback — no image rendering yet. Verifies the module slot-in works before we add complexity.

**Files:**
- Create: `src-ui/osc1337-renderer.ts`
- Create: `src-ui/osc1337-renderer.test.ts`

- [ ] **Step 5.1: Write the failing tests**

Create `src-ui/osc1337-renderer.test.ts`:

```typescript
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
    // The returned value must be a callable we can store and invoke later.
    expect(source).toMatch(/return\s+(?:function\s+dispose|\(\s*\)\s*=>)/);
  });

  it("imports the pure parser from osc1337", () => {
    expect(source).toMatch(/from\s+["']\.\/osc1337["']/);
  });

  it("writes the phase-1 text marker as fallback", () => {
    // "[inline image:" is the marker prefix. We keep the fallback path.
    expect(source).toContain("[inline image:");
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: FAIL — file does not exist yet.

- [ ] **Step 5.3: Implement the skeleton**

Create `src-ui/osc1337-renderer.ts`:

```typescript
import type { Terminal } from "@xterm/xterm";
import { parseOsc1337InlineImage } from "./osc1337";

export interface AttachOptions {
  /** Called when the user Cmd-clicks a rendered image. Receives a blob
   *  URL the caller can feed into Tauri's openUrl. Wired from terminal.ts
   *  so this module stays Tauri-agnostic and unit-testable. */
  onImageClick?: (blobUrl: string) => void;
}

/** Wire OSC 1337 inline-image rendering onto a terminal. Registers an
 *  OSC handler, owns an absolute-positioned overlay <div> inside
 *  `container`, and manages image lifecycles via xterm markers. Returns
 *  a dispose() that tears everything down and revokes every blob URL. */
export function attachOsc1337Renderer(
  term: Terminal,
  _container: HTMLElement,
  _opts: AttachOptions = {},
): () => void {
  const oscHandler = (data: string): boolean => {
    const parsed = parseOsc1337InlineImage(data);
    if (!parsed) return false;
    // Phase-2 rendering not yet wired — fall back to the phase-1 text marker
    // so the feature degrades cleanly while later tasks build up the
    // rendering pipeline.
    const fileLabel = parsed.name || "image";
    const geometry = [parsed.width, parsed.height].filter(Boolean).join("x") || "auto";
    const sizeLabel = parsed.size != null ? `${parsed.size} bytes` : "unknown size";
    term.write(`\r\n[inline image: ${fileLabel}, ${geometry}, ${sizeLabel}]\r\n`);
    return true;
  };

  const disposable = term.parser.registerOscHandler(1337, oscHandler);

  return () => {
    disposable.dispose();
  };
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: all pass.

- [ ] **Step 5.5: Commit**

```bash
git add src-ui/osc1337-renderer.ts src-ui/osc1337-renderer.test.ts
git commit -m "feat(osc1337): renderer module skeleton with text-marker fallback"
```

---

## Task 6: Swap terminal.ts wiring

Replace the inline OSC 1337 handler in `terminal.ts` with the new renderer. The behavior is identical at this point (still text marker), but proves the integration is clean before we add bitmap rendering.

**Files:**
- Modify: `src-ui/terminal.ts`

- [ ] **Step 6.1: Update the import at the top of `terminal.ts`**

Replace this line:

```typescript
import { parseOsc1337InlineImage } from "./osc1337";
```

with:

```typescript
import { attachOsc1337Renderer } from "./osc1337-renderer";
```

- [ ] **Step 6.2: Replace the inline OSC 1337 handler**

In `src-ui/terminal.ts`, find the block that starts with the comment `// OSC 1337 iTerm inline images.` (approximately lines 147–158) and replace the entire block (comment + `term.parser.registerOscHandler(1337, ...)` call) with:

```typescript
  // OSC 1337 iTerm inline images. Delegates to a dedicated renderer that
  // owns the DOM overlay, marker lifecycle, and Cmd-click open. Returned
  // dispose() is hooked into session.dispose() below.
  const disposeInlineImages = attachOsc1337Renderer(term, container);
```

- [ ] **Step 6.3: Hook `disposeInlineImages` into `session.dispose()`**

In the `session.dispose()` body, add `disposeInlineImages();` as the first line (before `onDataDisposable.dispose()`):

```typescript
    dispose() {
      disposeInlineImages();
      onDataDisposable.dispose();
      // ... rest unchanged
    },
```

- [ ] **Step 6.4: Run the full test suite**

Run: `npm test`
Expected: all tests pass. `terminal.test.ts` existing checks (Shift+Enter, Cmd-click, OSC handlers) still pass because we didn't change any of those.

- [ ] **Step 6.5: Commit**

```bash
git add src-ui/terminal.ts
git commit -m "refactor(terminal): delegate OSC 1337 to new renderer module"
```

---

## Task 7: Cell measurement + overlay container

Add the DOM overlay container and cell-dimension measurement to the renderer. Still no bitmap rendering — we're staging the infrastructure.

**Files:**
- Modify: `src-ui/osc1337-renderer.ts`
- Modify: `src-ui/osc1337-renderer.test.ts`
- Modify: `src-ui/kimbo.css`

- [ ] **Step 7.1: Add the failing tests**

Append to `src-ui/osc1337-renderer.test.ts`:

```typescript
describe("osc1337-renderer DOM scaffolding", () => {
  it("creates an overlay container with the expected class", () => {
    expect(source).toMatch(/kimbo-osc1337-overlay/);
  });

  it("appends the overlay to the container", () => {
    expect(source).toMatch(/container\.appendChild/);
  });

  it("removes the overlay on dispose", () => {
    expect(source).toMatch(/overlay\.remove\(\)|removeChild\(overlay\)/);
  });

  it("subscribes to term.onResize to invalidate cell cache", () => {
    expect(source).toMatch(/term\.onResize/);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: FAIL on the four new checks.

- [ ] **Step 7.3: Update the renderer**

Replace the whole `attachOsc1337Renderer` function body in `src-ui/osc1337-renderer.ts` with:

```typescript
export function attachOsc1337Renderer(
  term: Terminal,
  container: HTMLElement,
  _opts: AttachOptions = {},
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "kimbo-osc1337-overlay";
  container.appendChild(overlay);

  // Lazily measured on first use. Invalidated on term.onResize (font change
  // or pane resize both emit a resize event).
  let cachedCell: { width: number; height: number } | null = null;
  const measureCell = (): { width: number; height: number } | null => {
    if (cachedCell) return cachedCell;
    const row = container.querySelector(".xterm-rows > div") as HTMLElement | null;
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    // Approximate cell width by dividing row width by term.cols. Works
    // because xterm draws a monospace grid.
    const cols = term.cols || 80;
    cachedCell = { width: rect.width / cols, height: rect.height };
    return cachedCell;
  };

  const resizeDisposable = term.onResize(() => {
    cachedCell = null;
  });

  const oscHandler = (data: string): boolean => {
    const parsed = parseOsc1337InlineImage(data);
    if (!parsed) return false;
    // Still fallback-only; bitmap rendering lands in Task 8.
    const fileLabel = parsed.name || "image";
    const geometry = [parsed.width, parsed.height].filter(Boolean).join("x") || "auto";
    const sizeLabel = parsed.size != null ? `${parsed.size} bytes` : "unknown size";
    term.write(`\r\n[inline image: ${fileLabel}, ${geometry}, ${sizeLabel}]\r\n`);
    return true;
  };

  const oscDisposable = term.parser.registerOscHandler(1337, oscHandler);

  // Suppress "measureCell declared but unused" — it's exercised starting
  // in Task 8 when we wire actual image rendering. Keeping the declaration
  // now makes Task 8's diff smaller and easier to review.
  void measureCell;

  return () => {
    oscDisposable.dispose();
    resizeDisposable.dispose();
    overlay.remove();
  };
}
```

- [ ] **Step 7.4: Add the CSS rule**

Append to `src-ui/kimbo.css`:

```css
.kimbo-osc1337-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}
.kimbo-osc1337-overlay img {
  position: absolute;
  pointer-events: auto;
  user-select: none;
  -webkit-user-drag: none;
}
```

- [ ] **Step 7.5: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: all pass.

- [ ] **Step 7.6: Commit**

```bash
git add src-ui/osc1337-renderer.ts src-ui/osc1337-renderer.test.ts src-ui/kimbo.css
git commit -m "feat(osc1337): overlay container + cell measurement scaffolding"
```

---

## Task 8: Bitmap rendering pipeline (happy path)

Wire decode → sniff → load → layout → reserve rows → marker → `<img>`. This is the biggest task; it makes the feature real.

**Files:**
- Modify: `src-ui/osc1337-renderer.ts`
- Modify: `src-ui/osc1337-renderer.test.ts`

- [ ] **Step 8.1: Add the failing tests**

Append to `src-ui/osc1337-renderer.test.ts`:

```typescript
describe("osc1337-renderer bitmap pipeline", () => {
  it("calls decodeBase64Bytes with a 10MB cap", () => {
    expect(source).toMatch(/decodeBase64Bytes\s*\([^)]*10\s*\*\s*1024\s*\*\s*1024|decodeBase64Bytes\s*\([^)]*10_?485_?760/);
  });

  it("calls sniffBitmapFormat on the decoded bytes", () => {
    expect(source).toMatch(/sniffBitmapFormat\s*\(/);
  });

  it("calls resolveImageLayout before reserving rows", () => {
    expect(source).toMatch(/resolveImageLayout\s*\(/);
  });

  it("registers a marker at the top of the reserved rows", () => {
    expect(source).toMatch(/registerMarker\s*\(\s*-/);
  });

  it("creates a blob URL and an <img> element", () => {
    expect(source).toMatch(/createObjectURL/);
    expect(source).toMatch(/document\.createElement\(["']img["']\)/);
  });

  it("revokes the blob URL on marker dispose", () => {
    expect(source).toMatch(/revokeObjectURL/);
    expect(source).toMatch(/marker\.onDispose|onMarkerDispose/);
  });

  it("only renders when inline === 1 (download-only fallback)", () => {
    expect(source).toMatch(/\.inline\s*!==?\s*(?:true|1)|!parsed\.inline|!.*\.inline/);
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: FAIL on the seven new checks.

- [ ] **Step 8.3: Replace the OSC handler with the real pipeline**

In `src-ui/osc1337-renderer.ts`, (a) update imports, (b) add constants, (c) replace the `oscHandler` body, (d) add the `renderImage` helper and the `liveImages` registry. The full updated file should look like:

```typescript
import type { Terminal, IMarker } from "@xterm/xterm";
import {
  parseOsc1337InlineImage,
  decodeBase64Bytes,
  sniffBitmapFormat,
  resolveImageLayout,
  computeOverlayTop,
} from "./osc1337";

export interface AttachOptions {
  onImageClick?: (blobUrl: string) => void;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CONCURRENT = 50;

interface LiveImage {
  marker: IMarker;
  img: HTMLImageElement;
  blobUrl: string;
  rowsReserved: number;
}

export function attachOsc1337Renderer(
  term: Terminal,
  container: HTMLElement,
  opts: AttachOptions = {},
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "kimbo-osc1337-overlay";
  container.appendChild(overlay);

  let cachedCell: { width: number; height: number } | null = null;
  const measureCell = (): { width: number; height: number } | null => {
    if (cachedCell) return cachedCell;
    const row = container.querySelector(".xterm-rows > div") as HTMLElement | null;
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    const cols = term.cols || 80;
    cachedCell = { width: rect.width / cols, height: rect.height };
    return cachedCell;
  };

  const live: LiveImage[] = [];

  const repositionAll = () => {
    const cell = measureCell();
    if (!cell) return;
    const viewportTop = term.buffer.active.viewportY;
    for (const rec of live) {
      if (rec.marker.isDisposed) continue;
      rec.img.style.top = `${computeOverlayTop(
        { markerLine: rec.marker.line, viewportTop },
        cell,
      )}px`;
    }
  };

  const fallbackMarker = (parsed: ReturnType<typeof parseOsc1337InlineImage>, reason?: string) => {
    if (!parsed) return;
    const fileLabel = parsed.name || "image";
    const geometry = [parsed.width, parsed.height].filter(Boolean).join("x") || "auto";
    const sizeLabel = parsed.size != null ? `${parsed.size} bytes` : "unknown size";
    const suffix = reason ? `, ${reason}` : "";
    term.write(`\r\n[inline image: ${fileLabel}, ${geometry}, ${sizeLabel}${suffix}]\r\n`);
  };

  const renderImage = async (
    parsed: NonNullable<ReturnType<typeof parseOsc1337InlineImage>>,
    base64: string,
  ): Promise<void> => {
    const bytes = decodeBase64Bytes(base64, MAX_BYTES);
    if (!bytes) return fallbackMarker(parsed, "too large or invalid");
    const format = sniffBitmapFormat(bytes);
    if (!format) return fallbackMarker(parsed, "unsupported format");

    if (live.length >= MAX_CONCURRENT) {
      const oldest = live.shift();
      if (oldest) {
        URL.revokeObjectURL(oldest.blobUrl);
        oldest.img.remove();
        oldest.marker.dispose();
      }
    }

    const blob = new Blob([bytes], { type: `image/${format}` });
    const blobUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");

    const naturalReady = new Promise<{ width: number; height: number }>((resolve, reject) => {
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("decode failed"));
    });
    img.src = blobUrl;

    let natural: { width: number; height: number };
    try {
      natural = await naturalReady;
    } catch {
      URL.revokeObjectURL(blobUrl);
      return fallbackMarker(parsed, "decode failed");
    }

    const cell = measureCell();
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;
    if (!cell || !viewportWidth || !viewportHeight) {
      URL.revokeObjectURL(blobUrl);
      return fallbackMarker(parsed, "terminal not ready");
    }

    const layout = resolveImageLayout(
      {
        width: parsed.width,
        height: parsed.height,
        preserveAspectRatio: parsed.preserveAspectRatio,
      },
      natural,
      cell,
      { width: viewportWidth, height: viewportHeight },
    );

    // Reserve the rows so text that arrives next flows below the image.
    // term.write is async (xterm queues bytes on an internal parser loop),
    // so we register the marker in the completion callback — otherwise the
    // cursor may not yet have moved N rows down when we call
    // registerMarker(-N), and the marker anchors at the wrong line.
    await new Promise<void>((resolve) => {
      term.write("\r\n".repeat(layout.rowsToReserve), () => resolve());
    });

    const marker = term.registerMarker(-layout.rowsToReserve);
    if (!marker) {
      URL.revokeObjectURL(blobUrl);
      return fallbackMarker(parsed, "marker failed");
    }

    img.style.width = `${layout.pxWidth}px`;
    img.style.height = `${layout.pxHeight}px`;
    img.style.left = "0";
    img.alt = parsed.name || "inline image";
    if (opts.onImageClick) {
      img.addEventListener("click", (ev) => {
        if (!(ev as MouseEvent).metaKey) return;
        opts.onImageClick!(blobUrl);
      });
    }
    overlay.appendChild(img);

    const rec: LiveImage = { marker, img, blobUrl, rowsReserved: layout.rowsToReserve };
    live.push(rec);

    marker.onDispose(() => {
      URL.revokeObjectURL(rec.blobUrl);
      rec.img.remove();
      const idx = live.indexOf(rec);
      if (idx >= 0) live.splice(idx, 1);
    });

    repositionAll();
  };

  const oscHandler = (data: string): boolean => {
    const parsed = parseOsc1337InlineImage(data);
    if (!parsed) return false;

    if (!parsed.inline) {
      fallbackMarker(parsed, "download-only, not rendered");
      return true;
    }

    // Extract base64 payload (after the first ":" in the raw data).
    const colon = data.indexOf(":");
    const base64 = colon >= 0 ? data.slice(colon + 1) : "";

    // Fire-and-forget; failures inside render fall through to fallbackMarker.
    void renderImage(parsed, base64);
    return true;
  };

  const oscDisposable = term.parser.registerOscHandler(1337, oscHandler);
  const resizeDisposable = term.onResize(() => {
    cachedCell = null;
    repositionAll();
  });
  const scrollDisposable = term.onScroll(() => {
    repositionAll();
  });

  return () => {
    oscDisposable.dispose();
    resizeDisposable.dispose();
    scrollDisposable.dispose();
    for (const rec of live) {
      URL.revokeObjectURL(rec.blobUrl);
      rec.img.remove();
      rec.marker.dispose();
    }
    live.length = 0;
    overlay.remove();
  };
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: all pass (source-inspection checks hit their regexes).

- [ ] **Step 8.5: Run full test suite to catch regressions**

Run: `npm test`
Expected: everything green.

- [ ] **Step 8.6: Commit**

```bash
git add src-ui/osc1337-renderer.ts src-ui/osc1337-renderer.test.ts
git commit -m "feat(osc1337): render bitmaps via blob URL + xterm marker"
```

---

## Task 9: Cmd-click to open full-size

Wire the `onImageClick` callback from `terminal.ts` through Tauri's `openUrl`. Matches the existing OSC 8 / URL auto-detect pattern.

**Files:**
- Modify: `src-ui/terminal.ts`

- [ ] **Step 9.1: Update the renderer call in `terminal.ts`**

Find the line from Task 6:

```typescript
  const disposeInlineImages = attachOsc1337Renderer(term, container);
```

Replace with:

```typescript
  const disposeInlineImages = attachOsc1337Renderer(term, container, {
    onImageClick: (blobUrl) => {
      openUrl(blobUrl).catch((e) => console.error("openUrl failed:", e));
    },
  });
```

`openUrl` is already imported at the top of `terminal.ts`, so no new imports.

- [ ] **Step 9.2: Run the full test suite**

Run: `npm test`
Expected: green.

- [ ] **Step 9.3: Commit**

```bash
git add src-ui/terminal.ts
git commit -m "feat(osc1337): cmd-click inline image opens in system viewer"
```

---

## Task 10: Resize sync (invalidate cell cache + reposition)

The renderer already subscribes to `term.onResize` (Task 8), but it doesn't catch pane-level resizes that don't change the terminal's cell grid (e.g., a CSS-only font change or retina scale change). Add a `ResizeObserver` on the container.

**Files:**
- Modify: `src-ui/osc1337-renderer.ts`
- Modify: `src-ui/osc1337-renderer.test.ts`

- [ ] **Step 10.1: Add the failing test**

Append to `src-ui/osc1337-renderer.test.ts`:

```typescript
describe("osc1337-renderer resize sync", () => {
  it("installs a ResizeObserver on the container", () => {
    expect(source).toMatch(/new ResizeObserver/);
  });
  it("disposes the ResizeObserver on teardown", () => {
    expect(source).toMatch(/(?:resizeObserver|ro)\.disconnect\(\)/);
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: FAIL on the two new checks.

- [ ] **Step 10.3: Wire the ResizeObserver**

In `src-ui/osc1337-renderer.ts`, inside `attachOsc1337Renderer` and just before the `return () => { ... }` teardown, add:

```typescript
  const ro = new ResizeObserver(() => {
    cachedCell = null;
    repositionAll();
  });
  ro.observe(container);
```

Then in the teardown (the returned function), add `ro.disconnect();` at the top:

```typescript
  return () => {
    ro.disconnect();
    oscDisposable.dispose();
    // ... rest unchanged
  };
```

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `npx vitest run src-ui/osc1337-renderer.test.ts`
Expected: all pass.

- [ ] **Step 10.5: Commit**

```bash
git add src-ui/osc1337-renderer.ts src-ui/osc1337-renderer.test.ts
git commit -m "feat(osc1337): ResizeObserver keeps overlays aligned on pane resize"
```

---

## Task 11: Manual smoke test

No code changes — exercise the feature end-to-end in Kimbo and document what you observed in the commit.

**Files:** None (but you may add a short note to `CHANGELOG.md` if you normally do).

- [ ] **Step 11.1: Start Kimbo**

```bash
cd /Users/ruben/Projects/kimbo-terminal
npm start
```

Wait for the Tauri window to open.

- [ ] **Step 11.2: Verify fastfetch renders a logo inline**

Inside a Kimbo pane, run:

```bash
fastfetch --logo-type iterm --logo ~/path/to/any.png
```

Expected: the image appears above the system info, scales to fit, scrolls with the buffer. **No** `[inline image: ...]` text marker.

- [ ] **Step 11.3: Verify imgcat works**

If you have imgcat installed (`brew install imgcat` or iTerm2's built-in script):

```bash
imgcat ~/some/image.jpg
```

Expected: image renders inline at sensible size.

- [ ] **Step 11.4: Verify oversize fallback**

```bash
dd if=/dev/urandom of=/tmp/huge.bin bs=1m count=20 && imgcat /tmp/huge.bin
```

Expected: text marker `[inline image: ..., ..., too large or invalid]`. No crash, no lag spike.

- [ ] **Step 11.5: Verify scroll + resize**

1. Render an image via `imgcat`
2. Scroll up/down — image moves with text
3. Drag the pane divider to resize — image rescales (or at least stays aligned to its buffer rows)
4. Scroll far enough that the image leaves the scrollback — no console errors

- [ ] **Step 11.6: Verify Cmd-click**

Cmd-click a rendered image. Expected: opens in the system default viewer (Preview on macOS).

- [ ] **Step 11.7: Note any issues, fix them, then commit as a polish pass**

If you found issues, fix them in focused commits. If everything worked, there's nothing to commit — move to Task 12.

---

## Task 12: Update ROADMAP

`ROADMAP.md` currently lists "Inline Images" under "Future Ideas". Mark it shipped.

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 12.1: Remove the Inline Images entry from ROADMAP**

In `ROADMAP.md`, delete the block:

```markdown
## Inline Images
Render images directly in the terminal using the iTerm2 inline image protocol.
```

- [ ] **Step 12.2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: inline images shipped, remove from roadmap"
```

---

## Done

- Pure parsing + layout math in `src-ui/osc1337.ts` (12+ unit tests)
- DOM + marker lifecycle in `src-ui/osc1337-renderer.ts`
- Single wiring call in `src-ui/terminal.ts`
- Full iTerm sizing spec (cells / px / % / auto) supported
- Hard caps: 10 MB per image, 4096 px max dim, PNG/JPEG/GIF/WebP only; multipart byte cap during accumulation
- Image flows with scrollback via xterm marker; lifetime is bound to the marker, no separate concurrent-image cap
- Blob URLs revoked on every exit path — no leaks
