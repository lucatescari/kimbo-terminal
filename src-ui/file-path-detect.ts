// Pure file-path detection for terminal lines. No xterm or backend deps so the
// matching rules can be unit-tested in isolation — this is the precision-
// critical layer. Whether a detected candidate becomes a clickable link is
// decided downstream by an on-disk existence check (see file-path-links.ts),
// so this layer can be permissive: any token containing a "/" is a candidate,
// and false positives ("and/or", "v1/v2") simply fail to resolve and never get
// underlined.

export interface PathCandidate {
  /** Path text with surrounding punctuation and a trailing :line[:col]
   *  location suffix removed, e.g. "src-ui/settings.ts". */
  raw: string;
  /** 0-based column of the first character of `raw` within the line. */
  startCol: number;
  /** 0-based column just past the last character of `raw` (exclusive). */
  endCol: number;
}

// Punctuation that commonly hugs a path in prose or shell output.
const LEADING = new Set(["(", "[", "{", "<", "'", '"', "`"]);
const TRAILING = new Set([")", "]", "}", ">", "'", '"', "`", ",", ";", ".", ":"]);
const LOCATION_SUFFIX = /:\d+(:\d+)?$/; // :line or :line:col

/** Scan a line of terminal text and return every path-like token, with the
 *  exact column span of the path portion (location suffix excluded). */
export function detectFilePaths(line: string): PathCandidate[] {
  const out: PathCandidate[] = [];
  // Each match is a maximal run of non-whitespace characters; `index` gives the
  // run's column, which we then trim inward as we strip punctuation/suffix.
  const tokenRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(line)) !== null) {
    let start = m.index;
    let end = m.index + m[0].length;

    // Strip leading punctuation.
    while (start < end && LEADING.has(line[start])) start++;

    // Strip trailing punctuation and any :line[:col] suffix, repeatedly, so
    // interleavings like "file.ts:10." collapse fully (strip ".", then ":10").
    let changed = true;
    while (changed && start < end) {
      changed = false;
      while (end > start && TRAILING.has(line[end - 1])) {
        end--;
        changed = true;
      }
      const suffix = line.slice(start, end).match(LOCATION_SUFFIX);
      if (suffix) {
        end -= suffix[0].length;
        changed = true;
      }
    }

    if (end - start < 2) continue;
    const raw = line.slice(start, end);
    if (raw.includes("://")) continue; // URL — owned by WebLinksAddon / OSC 8
    if (!raw.includes("/")) continue; // single-segment token, not a path

    out.push({ raw, startCol: start, endCol: end });
  }
  return out;
}
