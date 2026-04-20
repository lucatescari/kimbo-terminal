import { describe, it, expect } from "vitest";
import { stripAnsiBlackBg } from "./ansi-bg-transparent";

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (s: string) => enc.encode(s);
const str = (b: Uint8Array) => dec.decode(b);

describe("stripAnsiBlackBg: ANSI black-bg rewrite to default bg", () => {
  it("is identity on plain text (no ESC, no allocation)", () => {
    const input = bytes("hello world\n");
    const out = stripAnsiBlackBg(input);
    expect(out).toBe(input); // same reference — fast path
    expect(str(out)).toBe("hello world\n");
  });

  it("rewrites a standalone \\x1b[40m → \\x1b[49m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[40m"))))
      .toBe("\x1b[49m");
  });

  it("rewrites \\x1b[100m (bright black bg) → \\x1b[49m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[100m"))))
      .toBe("\x1b[49m");
  });

  it("rewrites 256-color \\x1b[48;5;0m → \\x1b[49m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;5;0m"))))
      .toBe("\x1b[49m");
  });

  it("rewrites truecolor \\x1b[48;2;0;0;0m → \\x1b[49m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;0;0;0m"))))
      .toBe("\x1b[49m");
  });

  it("preserves siblings in a multi-param SGR: \\x1b[32;40m → \\x1b[32;49m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[32;40m Running \x1b[0m"))))
      .toBe("\x1b[32;49m Running \x1b[0m");
  });

  it("handles multiple black-bg selectors in one sequence", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[1;40;31;48;5;0m x"))))
      .toBe("\x1b[1;49;31;49m x");
  });

  it("does NOT rewrite non-black 256-color bg (\\x1b[48;5;1m stays)", () => {
    const input = bytes("\x1b[48;5;1m");
    const out = stripAnsiBlackBg(input);
    expect(str(out)).toBe("\x1b[48;5;1m");
    expect(out).toBe(input); // nothing changed → original reference
  });

  it("does NOT rewrite non-black truecolor bg (\\x1b[48;2;1;0;0m stays)", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;1;0;0m"))))
      .toBe("\x1b[48;2;1;0;0m");
  });

  it("does NOT touch fg=black \\x1b[30m (that's a foreground code)", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[30m black text"))))
      .toBe("\x1b[30m black text");
  });

  it("does NOT touch non-SGR CSI (cursor move, erase, …)", () => {
    // \x1b[2J clears screen, \x1b[5A moves cursor up 5, neither touched.
    expect(str(stripAnsiBlackBg(bytes("\x1b[2J\x1b[5A done"))))
      .toBe("\x1b[2J\x1b[5A done");
  });

  it("passes through a bare ESC or ESC-without-[ unchanged", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b hello"))))
      .toBe("\x1b hello");
  });

  it("passes through a truncated CSI with no final byte", () => {
    // Chunk arrives with \x1b[40 and nothing else — don't eat it.
    expect(str(stripAnsiBlackBg(bytes("\x1b[40"))))
      .toBe("\x1b[40");
  });

  it("UTF-8 multi-byte sequences survive round-trip", () => {
    // '🏳️‍🌈' and '—' include continuation bytes in 0x80–0xBF; the ASCII-only
    // pattern match must not mis-fire on them.
    // Input has 40 first, then 32. Param order is preserved — only the
    // 40 is replaced with 49, everything else untouched.
    const text = "\x1b[40;32m ✓ 🏳️‍🌈 — done\x1b[0m\n";
    const expected = "\x1b[49;32m ✓ 🏳️‍🌈 — done\x1b[0m\n";
    expect(str(stripAnsiBlackBg(bytes(text)))).toBe(expected);
  });

  it("reorders to put rewritten param where the original was (stable order)", () => {
    // '\x1b[32;40m' — fg green then bg black. After rewrite: fg green stays
    // at index 0, bg at index 1 becomes 49. Same positions, same meaning.
    const input = bytes("\x1b[32;40m");
    const out = stripAnsiBlackBg(input);
    expect(str(out)).toBe("\x1b[32;49m");
  });

  it("returns original reference when a chunk has ESC but no black-bg to rewrite", () => {
    // ESC present → hasEsc fast-path doesn't apply, but the rewrite loop
    // makes no change because no code is a black-bg selector.
    const input = bytes("\x1b[32m green");
    const out = stripAnsiBlackBg(input);
    expect(out).toBe(input);
    expect(str(out)).toBe("\x1b[32m green");
  });

  it("canonicalises empty params: \\x1b[m stays \\x1b[m (SGR reset)", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[m"))))
      .toBe("\x1b[m");
  });

  it("handles many back-to-back SGR sequences in one chunk", () => {
    const input =
      "\x1b[40m A \x1b[49m B \x1b[100m C \x1b[48;5;0m D \x1b[48;5;1m E";
    const expected =
      "\x1b[49m A \x1b[49m B \x1b[49m C \x1b[49m D \x1b[48;5;1m E";
    expect(str(stripAnsiBlackBg(bytes(input)))).toBe(expected);
  });
});
