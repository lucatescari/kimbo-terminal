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

  it("rewrites 256-color bright-black \\x1b[48;5;8m → \\x1b[49m", () => {
    // Webpack / angular-cli tables use palette index 8 (bright black)
    // as a dim panel bg. We need this to go transparent too.
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;5;8m"))))
      .toBe("\x1b[49m");
  });

  it("rewrites 256-color cube-black \\x1b[48;5;16m → \\x1b[49m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;5;16m"))))
      .toBe("\x1b[49m");
  });

  it("rewrites dark grayscale indices 232..237", () => {
    for (const idx of [232, 233, 234, 235, 236, 237]) {
      expect(
        str(stripAnsiBlackBg(bytes(`\x1b[48;5;${idx}m`))),
        `idx=${idx}`,
      ).toBe("\x1b[49m");
    }
  });

  it("does NOT rewrite mid-gray palette index 238 (#444)", () => {
    // Boundary: 237 is dark enough, 238 (#484848) isn't. Guard against
    // accidentally stripping legit mid-gray bgs if someone tweaks the
    // threshold.
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;5;238m"))))
      .toBe("\x1b[48;5;238m");
  });

  it("rewrites near-black truecolor (all channels <= 0x33)", () => {
    // Dim-panel bg used by ink/tauri/angular — each channel <= 0x33.
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;32;32;32m"))))
      .toBe("\x1b[49m");
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;51;51;51m"))))
      .toBe("\x1b[49m");
  });

  it("does NOT rewrite dark-but-saturated truecolor (one channel above threshold)", () => {
    // A dim red / navy / forest-green should survive — only *neutral*
    // near-blacks are stripped.
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;64;32;32m"))))
      .toBe("\x1b[48;2;64;32;32m");
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;20;20;80m"))))
      .toBe("\x1b[48;2;20;20;80m");
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

  it("does NOT rewrite clearly-coloured truecolor bg (\\x1b[48;2;200;0;0m stays)", () => {
    // Anything above the near-black threshold (channel > 0x33) must
    // survive — only neutral dim bgs are stripped.
    expect(str(stripAnsiBlackBg(bytes("\x1b[48;2;200;0;0m"))))
      .toBe("\x1b[48;2;200;0;0m");
  });

  it("does NOT touch fg=black \\x1b[30m (that's a foreground code)", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[30m black text"))))
      .toBe("\x1b[30m black text");
  });

  // DIM attribute rewrite — see the module header for the xterm.js WebGL bug
  // that motivates this. These tests pin the observable behaviour: any SGR
  // param of `2` (dim/faint) becomes `22` (no-dim) while every other param
  // in the same sequence passes through unchanged.
  it("dim \\x1b[2m → no-dim \\x1b[22m (xterm DIM+transparent-bg black-box fix)", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[2m"))))
      .toBe("\x1b[22m");
  });

  it("dim combined with bold: \\x1b[2;1m → \\x1b[22;1m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[2;1m"))))
      .toBe("\x1b[22;1m");
  });

  it("dim prompt marker: \\x1b[2m\\x1b[35m$\\x1b[0m passes the magenta and the reset, only kills 2", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[2m\x1b[35m$\x1b[0m"))))
      .toBe("\x1b[22m\x1b[35m$\x1b[0m");
  });

  it("dim AND black bg in one SGR: \\x1b[2;40;31m → \\x1b[22;49;31m", () => {
    expect(str(stripAnsiBlackBg(bytes("\x1b[2;40;31m"))))
      .toBe("\x1b[22;49;31m");
  });

  it("does NOT read the `2` inside fg-truecolor \\x1b[38;2;R;G;B as dim", () => {
    // 38;2;… is truecolor FG; its internal `2` is a sub-selector, not SGR
    // dim. Must pass through verbatim regardless of RGB values.
    expect(str(stripAnsiBlackBg(bytes("\x1b[38;2;251;240;223m"))))
      .toBe("\x1b[38;2;251;240;223m");
  });

  it("does NOT read the `2` inside fg-indexed \\x1b[38;5;N as dim", () => {
    // 38;5;… is indexed FG. No rewrite at all, even when N collides with
    // palette "dark-ish" indices that we DO rewrite on the bg side.
    expect(str(stripAnsiBlackBg(bytes("\x1b[38;5;0m"))))
      .toBe("\x1b[38;5;0m");
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
