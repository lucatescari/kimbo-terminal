import { describe, it, expect } from "vitest";
import { parseOsc1337InlineImage } from "./osc1337";

describe("parseOsc1337InlineImage", () => {
  it("parses a valid inline-image payload", () => {
    const msg = parseOsc1337InlineImage(
      "File=name=Y2F0LmpwZw==;width=28;height=9;inline=1;size=2048:YWJjZA==",
    );
    expect(msg).toEqual({
      name: "cat.jpg",
      width: "28",
      height: "9",
      preserveAspectRatio: true,
      inline: true,
      size: 2048,
    });
  });

  it("estimates size from base64 data when size attr is absent", () => {
    const msg = parseOsc1337InlineImage("File=inline=1:YWJjZA==");
    expect(msg?.size).toBe(4);
    expect(msg?.inline).toBe(true);
  });

  it("returns null for non-1337 image payloads", () => {
    expect(parseOsc1337InlineImage("foo=bar")).toBeNull();
    expect(parseOsc1337InlineImage("")).toBeNull();
  });
});

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

  it("allows explicit upscale requests when dimensions are provided", () => {
    const tiny = { width: 10, height: 10 };
    const out = resolveImageLayout(
      { width: "500px", height: "500px", preserveAspectRatio: true },
      tiny, cell, viewport,
    );
    expect(out.pxWidth).toBe(500);
    expect(out.pxHeight).toBe(500);
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

import { computeOverlayTop } from "./osc1337";

describe("computeOverlayTop", () => {
  const cell = { width: 8, height: 16 };

  it("returns top=0 when marker is at first visible row", () => {
    expect(computeOverlayTop({ markerLine: 10, viewportTop: 10 }, cell)).toBe(0);
  });

  it("returns positive top when marker is below viewport top", () => {
    expect(computeOverlayTop({ markerLine: 15, viewportTop: 10 }, cell)).toBe(80);
  });

  it("returns negative top when marker has scrolled above viewport", () => {
    expect(computeOverlayTop({ markerLine: 7, viewportTop: 10 }, cell)).toBe(-48);
  });
});
