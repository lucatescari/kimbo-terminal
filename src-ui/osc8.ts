import type { IMarker, Terminal } from "@xterm/xterm";

interface LinkRange {
  url: string;
  /** Markers, not raw line numbers. Absolute buffer indices captured at write
      time go stale: scrollback is capped, so once it is full every new line
      trims one off the top and shifts every existing line's index down by one.
      Stored numbers did not move with it, so links drifted onto unrelated text
      and kept serving their original URL. xterm keeps markers anchored to
      their line as the buffer trims, and disposes them once that line falls
      out of scrollback — which is also our signal to drop the range. Same
      idiom as the prompt markers in terminal.ts and osc1337-renderer.ts. */
  start: IMarker;
  startX: number;  // 0-based column at open
  end: IMarker;
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

/** Cap on the number of OSC 8 hyperlinks tracked per Terminal. Tools like
    `eza`, `ls --hyperlink`, `git` and `claude` emit OSC 8 constantly, so
    without a cap `ranges` grew unboundedly over a long session.

    This number buys down TWO costs, and the second is the binding one:

    1. Hover cost. `provideLinks` walks every range per visible line, so a
       large array slowed every hover event.
    2. Per-output-line cost. Ranges are anchored to markers, and xterm's
       `addMarker` attaches three listeners per marker (`onTrim`, `onInsert`,
       `onDelete`) to the buffer's line list. Once scrollback is full, EVERY
       new output line fires `onTrimEmitter.fire(1)`, which walks all of them
       — two markers per range, whether or not any link is hovered.

    Measured against real xterm (scrollback 1000, saturated, 2000 plain
    writes): 0 markers 2.5µs/line, 1,000 markers 12.5µs, 5,000 markers 56.6µs,
    10,000 markers 139µs. Linear, and paid for the rest of the session rather
    than only during link-heavy output. At 500 ranges (1,000 markers) that is
    ~12.5µs per line; a 5,000 cap would be ~55x baseline.

    Raising this number is therefore not free — it is a per-output-line tax on
    the whole session, not just a bigger array. Marker disposal now prunes
    links as they leave scrollback, which the pre-marker code could not do, so
    the FIFO cap is no longer the only bound: it is a backstop against
    many-links-on-one-line output such as eza's grid. */
const MAX_TRACKED_RANGES = 500;

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
  let openLink: { url: string; start: IMarker; startX: number } | null = null;

  function pushRange(r: LinkRange): void {
    ranges.push(r);
    // Dispose the evicted range's markers so xterm stops tracking them too —
    // dropping the array entry alone would leak them for the Terminal's life.
    while (ranges.length > MAX_TRACKED_RANGES) {
      const evicted = ranges.shift();
      evicted?.start.dispose();
      evicted?.end.dispose();
    }
  }

  /** Close the currently open link at the cursor. As at open, the missing-end
      marker branch is defensive rather than reachable under 5.x typings; an
      untracked link is a missing underline, which beats one pointing at the
      wrong text. */
  function closeOpenLink(): void {
    if (!openLink) return;
    const end = term.registerMarker(0);
    if (end) {
      pushRange({
        url: openLink.url,
        start: openLink.start,
        startX: openLink.startX,
        end,
        endX: term.buffer.active.cursorX,
      });
    } else {
      openLink.start.dispose();
    }
    openLink = null;
  }

  term.parser.registerOscHandler(8, (data) => {
    // OSC 8 payload format: "params;url" for open, ";" or "" for close.
    const semi = data.indexOf(";");
    const url = semi >= 0 ? data.slice(semi + 1) : "";

    // A new open while one is already in flight means the tool skipped its
    // close — close implicitly at the current position, then start fresh.
    // Defensive.
    if (openLink) closeOpenLink();

    if (url) {
      // @xterm/xterm 5.x types registerMarker as returning IMarker, so this
      // guard is belt-and-braces rather than a reachable path; it mirrors the
      // prompt-marker call in terminal.ts. If a marker ever were missing there
      // would be no reliable anchor, and not tracking the link is better than
      // falling back to a coordinate that will drift.
      const start = term.registerMarker(0);
      if (start) {
        openLink = { url, start, startX: term.buffer.active.cursorX };
      }
    }
    return true;
  });

  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      // bufferLineNumber is 1-based absolute buffer line (same coordinate
      // system as IBufferCellPosition.y). See xterm's WebLinkProvider for
      // reference. NOT viewport-relative.
      //
      // Plain for-loop instead of flatMap: avoids creating N intermediate
      // singleton/empty arrays on every hover event (called frequently).
      const links: Array<{
        range: { start: { x: number; y: number }; end: { x: number; y: number } };
        text: string;
        activate: (event: MouseEvent, text: string) => void;
      }> = [];
      // Reverse order, newest range first. Two consequences, both wanted:
      // it lets a range be spliced out mid-walk when its marker is gone, and
      // because xterm takes the FIRST match for a cell, the newest link wins
      // when two overlap — a re-emitted link on the same cells supersedes the
      // stale one rather than being shadowed by it.
      for (let i = ranges.length - 1; i >= 0; i--) {
        const r = ranges[i];
        // A disposed marker means its line was trimmed out of scrollback, so
        // the link no longer refers to anything. Prune here rather than on a
        // timer: this loop already visits every range.
        if (r.start.isDisposed || r.end.isDisposed) {
          ranges.splice(i, 1);
          continue;
        }
        const clipped = clipLinkRangeForLine(
          { startY: r.start.line, startX: r.startX, endY: r.end.line, endX: r.endX },
          bufferLineNumber,
          term.cols,
        );
        if (clipped) {
          links.push({
            range: clipped,
            text: r.url,
            activate: (event: MouseEvent) => onActivate(event, r.url),
          });
        }
      }
      callback(links);
    },
  });

  return {
    size: () => ranges.length,
  };
}
