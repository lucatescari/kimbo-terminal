import { detectFilePaths } from "./file-path-detect";

/** Pure detection of a path split across a hanging-indent soft wrap. No xterm
 *  or backend deps, so the matching rules can be unit-tested on their own.
 *
 *  Why this exists alongside the wrapped-row stitching in file-path-links.ts:
 *  xterm flags a row that it wrapped itself, and those rows can be
 *  concatenated blind. A full-screen TUI does its own layout instead. Claude
 *  Code prints an image attachment as "[image]<path>", breaks the path at the
 *  pane width, and indents each remainder under it, so the terminal receives
 *  several ordinary lines and none of them carries the wrapped flag. Without
 *  joining them the first row holds a path that does not exist and the rest
 *  have no slash in them, which is why no part of a screenshot path was ever
 *  clickable.
 *
 *  Nothing here decides anything. A chain is a question for the on-disk
 *  existence check: the caller links it only when the first fragment does not
 *  resolve on its own and the joined path does. That is what stops an
 *  accidental pairing of unrelated lines from ever being underlined. */

/** Rows in one chain, counting the row that starts it. Three continuations is
 *  enough for a long path in a narrow split pane; the cap bounds both the
 *  false-join surface and the number of existence checks a hover can cost. */
const MAX_CHAIN_ROWS = 4;

/** Leading whitespace followed by one run of non-whitespace. The indent is
 *  what marks a row as a continuation rather than a fresh line of output. */
const INDENTED_HEAD = /^(\s+)(\S+)/;

export interface ChainPiece {
  /** Index into the `rows` passed in. */
  row: number;
  /** 0-based column of the fragment's first character in that row. */
  startCol: number;
  /** 0-based column just past its last character. */
  endCol: number;
  raw: string;
}

export interface ContinuationChain {
  /** Fragments in order. Concatenating a prefix of these gives a path to try
   *  on disk; the first piece is the tail of the row that starts the chain. */
  pieces: ChainPiece[];
}

/** Find the chains within `rows` (consecutive row texts) that include row
 *  `target`. One chain per plausible tail on the starting row, longest tail
 *  first. */
export function detectContinuationChains(
  rows: string[],
  target: number,
): ContinuationChain[] {
  const out: ContinuationChain[] = [];

  // The chain can start on the target row or on any of the rows above it that
  // is still close enough to reach the target within the cap.
  const earliest = Math.max(0, target - (MAX_CHAIN_ROWS - 1));
  for (let start = earliest; start <= target; start++) {
    const first = rows[start];
    if (first === undefined) continue;

    // Only a fragment flush against the end of its row can have been broken
    // by wrapping; anything with text after it was printed whole. Trailing
    // whitespace does not count as text after it: xterm's own right-trim only
    // drops cells that were never written, and a TUI that pads its rows leaves
    // real spaces behind the fragment.
    const end = first.replace(/\s+$/, "").length;
    const tails = detectFilePaths(first).filter((c) => c.endCol === end);
    if (tails.length === 0) continue;

    // Collect the indented continuations that follow, stopping at the first
    // row that is not one.
    const continuations: ChainPiece[] = [];
    for (let row = start + 1; row < rows.length; row++) {
      if (continuations.length + 1 >= MAX_CHAIN_ROWS) break;
      const head = INDENTED_HEAD.exec(rows[row]);
      if (!head) break;
      const startCol = head[1].length;
      continuations.push({
        row,
        startCol,
        endCol: startCol + head[2].length,
        raw: head[2],
      });
    }
    if (continuations.length === 0) continue;

    // The row we were asked about has to be part of what we found, or this
    // chain says nothing about it.
    if (target > start + continuations.length) continue;

    for (const tail of tails) {
      out.push({
        pieces: [
          {
            row: start,
            startCol: tail.startCol,
            endCol: tail.endCol,
            raw: tail.raw,
          },
          ...continuations,
        ],
      });
    }
  }

  return out;
}
