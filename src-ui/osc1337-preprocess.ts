/**
 * Stateful PTY-output preprocessor that makes iTerm2 OSC 1337 inline images
 * behave correctly against xterm.js.
 *
 * Why this module exists:
 *   iTerm2 advances the cursor by the image's cell-height after rendering an
 *   inline image. Apps like fastfetch depend on that — fastfetch emits
 *   `\x1b]1337;…\x07 \r\n \x1b[9A \x1b[32C <info>` and uses the CUU (cursor
 *   up) to step back to the image's top row for right-side info lines.
 *   xterm.js does not advance the cursor on OSC 1337, and a `term.write` call
 *   made from inside the OSC handler is queued *after* the rest of the
 *   current parser chunk — so fastfetch's `\x1b[9A` fires against the
 *   un-advanced cursor and lands N rows above the image, overwriting
 *   earlier content (the "second `zsh` overlaps" symptom).
 *
 *   The only place an injected `\r\n * height` can run at the right time is
 *   before the bytes reach xterm's parser at all. This module sits between
 *   the PTY reader and `term.write`, scans the stream for OSC 1337 inline
 *   images with integer width *and* height attrs, and splices the newlines
 *   in immediately after each OSC terminator. OSC sequences that straddle a
 *   PTY chunk boundary are buffered until the terminator arrives.
 *
 *   Non-cell sizings (px / % / auto, or missing dims) are passed through
 *   untouched — callers of those forms (imgcat, custom scripts) manage
 *   their own cursor layout. The preprocessor never decodes the base64 body
 *   and never allocates over the payload itself — it only rewrites a handful
 *   of bytes at each OSC boundary.
 */
export class Osc1337CursorAdvancer {
  private pending = "";

  transform(chunk: string): string {
    const combined = this.pending + chunk;
    this.pending = "";
    let out = "";
    let cursor = 0;

    while (cursor < combined.length) {
      const oscStart = combined.indexOf(OSC_1337_PREFIX, cursor);
      if (oscStart < 0) {
        // No more OSC 1337 starts — emit the rest and finish. If a partial
        // OSC prefix is at the tail we keep it so the next chunk can
        // complete it. Without this guard the prefix bytes would be emitted
        // and the continuation arriving in the next chunk would look like
        // a fresh OSC to us, throwing off injection alignment.
        const partial = findTrailingPartialPrefix(combined, cursor);
        if (partial >= 0) {
          out += combined.slice(cursor, partial);
          this.pending = combined.slice(partial);
        } else {
          out += combined.slice(cursor);
        }
        return out;
      }

      // Emit everything up to the OSC start.
      out += combined.slice(cursor, oscStart);

      // Locate the terminator — BEL (0x07) or ST (ESC `\`).
      const end = findOscTerminator(combined, oscStart + OSC_1337_PREFIX.length);
      if (end === null) {
        // Incomplete OSC — stash the whole thing, emit nothing for it yet.
        this.pending = combined.slice(oscStart);
        return out;
      }

      // Emit the OSC (unmodified) and optionally the injected newlines.
      const oscEnd = end.index + end.length;
      const osc = combined.slice(oscStart, oscEnd);
      out += osc;

      const cellRows = parseCellHeight(osc);
      if (cellRows > 0) {
        out += "\r\n".repeat(cellRows);
      }

      cursor = oscEnd;
    }

    return out;
  }

  /** Drop any buffered partial OSC. Call on session teardown or when the
   *  shell resets (e.g. running program exits uncleanly) so stale pending
   *  bytes can't glue onto the next real chunk. */
  reset(): void {
    this.pending = "";
  }
}

const OSC_1337_PREFIX = "\x1b]1337;";

/** Find BEL or ST terminator after `from`. Returns the position and the
 *  terminator length (1 for BEL, 2 for ST). Base64 data never contains
 *  0x07 or 0x1B, so the scan is unambiguous for well-formed OSC payloads. */
function findOscTerminator(
  s: string,
  from: number,
): { index: number; length: number } | null {
  let candidate: { index: number; length: number } | null = null;
  const bel = s.indexOf("\x07", from);
  if (bel >= 0) candidate = { index: bel, length: 1 };
  const st = s.indexOf("\x1b\\", from);
  if (st >= 0 && (candidate === null || st < candidate.index)) {
    candidate = { index: st, length: 2 };
  }
  return candidate;
}

/** Check the tail of `s` for a *partial* OSC 1337 start — any prefix of
 *  `\x1b]1337;`. Returns the index the partial starts at, or -1 if the
 *  tail cannot possibly be the beginning of our prefix. Used so we don't
 *  emit half a prefix and then collide with its completion next chunk. */
function findTrailingPartialPrefix(s: string, from: number): number {
  for (let len = Math.min(OSC_1337_PREFIX.length - 1, s.length - from); len > 0; len--) {
    const start = s.length - len;
    if (start < from) break;
    if (OSC_1337_PREFIX.startsWith(s.slice(start))) return start;
  }
  return -1;
}

/** Given a complete OSC 1337 sequence (from `\x1b]1337;` through its
 *  terminator inclusive), return `height` in cells if the payload is
 *  `File=…width=<int>…height=<int>…:<data>`. Returns 0 otherwise. */
function parseCellHeight(osc: string): number {
  const attrsStart = OSC_1337_PREFIX.length;
  const colon = osc.indexOf(":", attrsStart);
  if (colon < 0) return 0;
  const attrsRaw = osc.slice(attrsStart, colon);
  if (!attrsRaw.startsWith("File=")) return 0;
  let width = "";
  let height = "";
  for (const pair of attrsRaw.slice("File=".length).split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    if (key === "width") width = pair.slice(eq + 1);
    else if (key === "height") height = pair.slice(eq + 1);
  }
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return 0;
  return Number(height);
}

function isPositiveInteger(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
}
