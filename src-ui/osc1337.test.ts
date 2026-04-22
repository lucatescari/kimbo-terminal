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
