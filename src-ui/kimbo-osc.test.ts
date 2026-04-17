import { describe, it, expect } from "vitest";
import { parseOsc133 } from "./kimbo-osc";

describe("parseOsc133", () => {
  it("parses command-start ('C')", () => {
    expect(parseOsc133("C")).toEqual({ kind: "command-start" });
  });

  it("parses command-end with exit 0 ('D;0')", () => {
    expect(parseOsc133("D;0")).toEqual({ kind: "command-end", exit: 0 });
  });

  it("parses command-end with non-zero exit ('D;127')", () => {
    expect(parseOsc133("D;127")).toEqual({ kind: "command-end", exit: 127 });
  });

  it("parses command-end without exit code ('D') as exit 0", () => {
    expect(parseOsc133("D")).toEqual({ kind: "command-end", exit: 0 });
  });

  it("ignores unknown payloads", () => {
    expect(parseOsc133("P;something")).toBeNull();
    expect(parseOsc133("")).toBeNull();
  });

  it("ignores malformed exit codes", () => {
    expect(parseOsc133("D;notanumber")).toEqual({ kind: "command-end", exit: 0 });
  });
});
