import { describe, it, expect } from "vitest";

import { detectContinuationChains } from "./file-path-continuation";

/** The rows Claude Code prints for an image attachment at ~34 columns: it
 *  breaks the path itself and indents each remainder under the first row. */
const WIDE = [
  "  › [image]/tmp/kimbo/scratch/n",
  "        ew-desktop.png      (109KB)",
];
const NARROW = [
  "  › [image]/tmp/kimbo/scra",
  "        tch/new-desk",
  "        top.png      (109KB)",
];

/** Every fragment of a chain, in order, as text. */
function fragments(rows: string[], pieces: { row: number; startCol: number; endCol: number }[]) {
  return pieces.map((p) => rows[p.row].slice(p.startCol, p.endCol));
}

describe("detectContinuationChains", () => {
  it("chains a path broken once, from the row that starts it", () => {
    const chains = detectContinuationChains(WIDE, 0);

    const chain = chains.find((c) => c.pieces[0].raw.startsWith("/tmp"))!;
    expect(chain).toBeDefined();
    expect(fragments(WIDE, chain.pieces)).toEqual([
      "/tmp/kimbo/scratch/n",
      "ew-desktop.png",
    ]);
  });

  it("chains the same path when asked about the continuation row", () => {
    const chains = detectContinuationChains(WIDE, 1);

    const chain = chains.find((c) => c.pieces[0].raw.startsWith("/tmp"))!;
    expect(fragments(WIDE, chain.pieces)).toEqual([
      "/tmp/kimbo/scratch/n",
      "ew-desktop.png",
    ]);
  });

  it("chains a path broken across three rows, asked about the middle", () => {
    const chains = detectContinuationChains(NARROW, 1);

    const chain = chains.find((c) => c.pieces[0].raw.startsWith("/tmp"))!;
    expect(fragments(NARROW, chain.pieces)).toEqual([
      "/tmp/kimbo/scra",
      "tch/new-desk",
      "top.png",
    ]);
  });

  it("offers the tag-stripped and raw fragments as separate chains", () => {
    // "[image]" glued to the front leaves two plausible tails; which one is
    // real is settled downstream by looking on disk.
    const rows = ["[image]/tmp/a/sho", "   t.png"];
    expect(
      detectContinuationChains(rows, 0).map((c) =>
        c.pieces.map((p) => p.raw).join(""),
      ),
    ).toEqual(["image]/tmp/a/shot.png", "/tmp/a/shot.png"]);
  });

  it("only chains a fragment flush against the end of its row", () => {
    // A path with text after it was printed whole, not broken by wrapping.
    expect(detectContinuationChains(["see /tmp/a/b and more", "    x.png"], 0)).toEqual([]);
  });

  it("requires every continuation row to be indented", () => {
    expect(detectContinuationChains(["/tmp/a/b", "c.png"], 0)).toEqual([]);
  });

  it("ignores a continuation row that is only whitespace", () => {
    expect(detectContinuationChains(["/tmp/a/b", "        "], 0)).toEqual([]);
  });

  it("ignores a row with no path-like tail", () => {
    expect(detectContinuationChains(["just words here", "    more.png"], 0)).toEqual([]);
  });

  it("returns nothing when the row asked about is outside every chain", () => {
    // Row 2 is a fresh unindented line, so it belongs to no chain.
    const rows = ["  /tmp/a/sho", "     t.png", "done"];
    expect(detectContinuationChains(rows, 2)).toEqual([]);
  });

  it("chains a path broken across eight rows", () => {
    // A real path in a narrow split pane needs more than a couple of breaks:
    // ~/Library/Application Support/Kimbo/screenshots/<name>.png at 25 usable
    // columns is six or seven rows. The cap fails all-or-nothing (every prefix
    // of a too-long chain is truncated, so nothing resolves), so it has to be
    // high enough to cover a genuine path rather than merely bound the work.
    const rows = [
      "/tmp/a",
      "   /bb",
      "   /cc",
      "   /dd",
      "   /ee",
      "   /ff",
      "   /gg",
      "   /hh.png",
    ];
    const chain = detectContinuationChains(rows, 7)[0];
    expect(chain.pieces).toHaveLength(8);
    expect(chain.pieces.map((p) => p.raw).join("")).toBe(
      "/tmp/a/bb/cc/dd/ee/ff/gg/hh.png",
    );
  });

  it("still stops somewhere, so a hover cannot cost unbounded work", () => {
    const rows = ["/tmp/a", ...Array.from({ length: 20 }, (_, i) => `   /${i}`)];
    const chain = detectContinuationChains(rows, 0)[0];
    expect(chain.pieces.length).toBeLessThanOrEqual(8);
  });

  it("chains a fragment that a TUI padded with trailing spaces", () => {
    // xterm's trimRight only drops cells that were never written: a space the
    // TUI actually printed has content and survives translateToString(true).
    // Claude Code pads its transcript rows, so the fragment is not flush with
    // the string end even after xterm trims.
    const rows = ["  \u203a [image]/tmp/kimbo/scratch/n     ", "        ew-desktop.png"];

    const chain = detectContinuationChains(rows, 0).find((c) =>
      c.pieces[0].raw.startsWith("/tmp"),
    );

    expect(chain).toBeDefined();
    expect(chain!.pieces.map((p) => p.raw).join("")).toBe(
      "/tmp/kimbo/scratch/new-desktop.png",
    );
    // The span must still point at the fragment, not at the padding.
    expect(rows[0].slice(chain!.pieces[0].startCol, chain!.pieces[0].endCol)).toBe(
      "/tmp/kimbo/scratch/n",
    );
  });
});
