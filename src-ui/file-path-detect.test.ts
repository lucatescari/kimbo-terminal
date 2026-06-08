// @vitest-environment node
import { describe, it, expect } from "vitest";
import { detectFilePaths } from "./file-path-detect";

describe("detectFilePaths", () => {
  it("detects an absolute path and reports exact columns", () => {
    const line = "see /Users/luca/file.txt here";
    const [c] = detectFilePaths(line);
    expect(c.raw).toBe("/Users/luca/file.txt");
    expect(line.slice(c.startCol, c.endCol)).toBe("/Users/luca/file.txt");
  });

  it("detects a home (~/) path", () => {
    const [c] = detectFilePaths("~/Documents/notes.md");
    expect(c.raw).toBe("~/Documents/notes.md");
  });

  it("detects a bare relative path (Claude Code style)", () => {
    const [c] = detectFilePaths("edited src-ui/settings.ts ok");
    expect(c.raw).toBe("src-ui/settings.ts");
  });

  it("detects ./ and ../ relative paths", () => {
    expect(detectFilePaths("./a/b.ts")[0].raw).toBe("./a/b.ts");
    expect(detectFilePaths("../x/y.rs")[0].raw).toBe("../x/y.rs");
  });

  it("strips a trailing :line suffix but keeps the path columns", () => {
    const line = "at src-ui/settings.ts:10 now";
    const [c] = detectFilePaths(line);
    expect(c.raw).toBe("src-ui/settings.ts");
    expect(line.slice(c.startCol, c.endCol)).toBe("src-ui/settings.ts");
  });

  it("strips a trailing :line:col suffix", () => {
    const [c] = detectFilePaths("file a/b/c.ts:120:8 x");
    expect(c.raw).toBe("a/b/c.ts");
  });

  it("strips surrounding parens/brackets/quotes", () => {
    expect(detectFilePaths("(./foo/bar.rs)")[0].raw).toBe("./foo/bar.rs");
    expect(detectFilePaths("[/etc/hosts]")[0].raw).toBe("/etc/hosts");
  });

  it("only sees up to the first space (paths with spaces are out of scope)", () => {
    // Tokenized on whitespace, so a quoted path with a space yields only its
    // pre-space portion; the trailing 'c"' has no slash and is dropped.
    expect(detectFilePaths('"/a/b c"').map((c) => c.raw)).toEqual(["/a/b"]);
  });

  it("strips a trailing sentence period", () => {
    expect(detectFilePaths("open /a/b/c.ts.")[0].raw).toBe("/a/b/c.ts");
  });

  it("excludes URLs (http/https/file scheme)", () => {
    expect(detectFilePaths("https://example.com/path")).toEqual([]);
    expect(detectFilePaths("file:///Users/x/y")).toEqual([]);
  });

  it("ignores tokens with no slash", () => {
    expect(detectFilePaths("just a plain word e.g. v1.2.3")).toEqual([]);
  });

  it("detects multiple paths on one line with correct columns", () => {
    const line = "cp /a/one.txt /b/two.txt";
    const got = detectFilePaths(line);
    expect(got.map((c) => c.raw)).toEqual(["/a/one.txt", "/b/two.txt"]);
    for (const c of got) {
      expect(line.slice(c.startCol, c.endCol)).toBe(c.raw);
    }
  });

  it("returns nothing for an empty or whitespace line", () => {
    expect(detectFilePaths("")).toEqual([]);
    expect(detectFilePaths("   \t ")).toEqual([]);
  });
});
