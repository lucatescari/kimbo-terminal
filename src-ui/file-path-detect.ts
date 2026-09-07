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

/** Whether a token names something, rather than being only separators. A run
 *  of slashes and dots canonicalizes to a directory that always exists ("//"
 *  and "/./" both become "/"), so without this every "//" in a comment and
 *  every "s/./x/" underlined the filesystem root. Both places a candidate is
 *  emitted have to check, which is why this is a named helper: the first
 *  version guarded only the outer token and "arr[i]//" still produced one. */
function isNameable(raw: string): boolean {
  return /[^/.]/.test(raw);
}

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
    if (!isNameable(raw)) continue;

    out.push({ raw, startCol: start, endCol: end });

    // A tag glued to the front of a path survives the leading-punctuation
    // strip as e.g. "image]/abs/shot.png" (Claude Code prints image
    // attachments as "[image]<path>" with no separating space), and that never
    // resolves on disk. Emit the inner path as an extra candidate too; the
    // downstream existence check drops whichever of the two is not real.
    const firstSlash = raw.indexOf("/");
    const tagEnd = raw.lastIndexOf("]", firstSlash);
    if (tagEnd > 0 && end - (start + tagEnd + 1) >= 2) {
      const inner = raw.slice(tagEnd + 1);
      if (isNameable(inner)) {
        out.push({
          raw: inner,
          startCol: start + tagEnd + 1,
          endCol: end,
        });
      }
    }
  }
  return out;
}
