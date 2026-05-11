import type { Terminal } from "@xterm/xterm";

interface LinkRange {
  url: string;
  startY: number;  // 0-based absolute buffer line at open time
  startX: number;  // 0-based column at open
  endY: number;    // 0-based absolute buffer line at close
  endX: number;    // 0-based column AFTER the last link cell (cursor position
                   // after writing the link text); used directly as the
                   // 1-based-inclusive IBufferRange.end.x.
}

/** Compute the IBufferRange start/end for a single buffer line, given a
    stored LinkRange.  Returns null when the range does not intersect
    bufferLineNumber.

    bufferLineNumber uses the same 1-based absolute coordinate as
    ILinkProvider.provideLinks and IBufferCellPosition.y.  Internally we
    subtract 1 to compare against the 0-based values stored in LinkRange. */
export function clipLinkRangeForLine(
  range: { startY: number; startX: number; endY: number; endX: number },
  bufferLineNumber: number,
  termCols: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const absoluteY = bufferLineNumber - 1;
  if (range.startY > absoluteY || range.endY < absoluteY) return null;
  return {
    start: {
      x: range.startY === absoluteY ? range.startX + 1 : 1,
      y: bufferLineNumber,
    },
    end: {
      x: range.endY === absoluteY ? range.endX : termCols,
      y: bufferLineNumber,
    },
  };
}

/** Cap on the number of OSC 8 hyperlinks tracked per Terminal. Without a cap,
    `ranges` grew unboundedly over a long session — tools like `eza`,
    `ls --hyperlink`, `git`, and `claude` emit OSC 8 constantly. The
    accumulated array stayed live for the Terminal's lifetime and slowed every
    hover-triggered `provideLinks` callback (flatMap over N entries per line).
    With a cap, oldest entries fall off via FIFO eviction; in practice that
    drops links to scrollback rows the user is unlikely to revisit, while
    keeping anything emitted recently. */
const MAX_TRACKED_RANGES = 5_000;

export interface Osc8LinkHandle {
  /** Current number of tracked link ranges. Bounded by MAX_TRACKED_RANGES.
      Used by tests to verify the cap; production code can ignore it. */
  size(): number;
}

/** Hook OSC 8 hyperlinks (`\x1b]8;params;url\x07text\x1b]8;;\x07`) on a
    terminal. Tracks link ranges as they are written and registers a link
    provider so xterm shows the underline on hover and routes clicks to
    the supplied onActivate callback. The callback receives the original
    MouseEvent so callers can gate on metaKey (Cmd) the same way the
    URL auto-detector does. */
export function attachOsc8Links(
  term: Terminal,
  onActivate: (event: MouseEvent, uri: string) => void,
): Osc8LinkHandle {
  const ranges: LinkRange[] = [];
  let openLink: { url: string; startY: number; startX: number } | null = null;

  function pushRange(r: LinkRange): void {
    ranges.push(r);
    if (ranges.length > MAX_TRACKED_RANGES) ranges.shift();
  }

  term.parser.registerOscHandler(8, (data) => {
    // OSC 8 payload format: "params;url" for open, ";" or "" for close.
    const semi = data.indexOf(";");
    const url = semi >= 0 ? data.slice(semi + 1) : "";
    const cursor = term.buffer.active;

    if (url && !openLink) {
      openLink = {
        url,
        startY: cursor.baseY + cursor.cursorY,
        startX: cursor.cursorX,
      };
    } else if (!url && openLink) {
      pushRange({
        url: openLink.url,
        startY: openLink.startY,
        startX: openLink.startX,
        endY: cursor.baseY + cursor.cursorY,
        endX: cursor.cursorX,
      });
      openLink = null;
    } else if (url && openLink) {
      // Tool emitted a new open without closing the previous one — close it
      // implicitly at the current position and start fresh. Defensive.
      pushRange({
        url: openLink.url,
        startY: openLink.startY,
        startX: openLink.startX,
        endY: cursor.baseY + cursor.cursorY,
        endX: cursor.cursorX,
      });
      openLink = {
        url,
        startY: cursor.baseY + cursor.cursorY,
        startX: cursor.cursorX,
      };
    }
    return true;
  });

  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      // bufferLineNumber is 1-based absolute buffer line (same coordinate
      // system as IBufferCellPosition.y). See xterm's WebLinkProvider for
      // reference. NOT viewport-relative.
      const links = ranges.flatMap((r) => {
        const clipped = clipLinkRangeForLine(r, bufferLineNumber, term.cols);
        if (!clipped) return [];
        return [{
          range: clipped,
          text: r.url,
          activate: (event: MouseEvent, _text: string) => onActivate(event, r.url),
        }];
      });
      callback(links);
    },
  });

  return {
    size: () => ranges.length,
  };
}
