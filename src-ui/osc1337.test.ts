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
