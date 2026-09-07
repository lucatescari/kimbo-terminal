import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { detectFilePaths } from "./file-path-detect";
import { choosePathAction } from "./file-path-action";
import { clipLinkRangeForLine } from "./osc8";
import { detectContinuationChains } from "./file-path-continuation";
import { isPreviewableImage, type ImagePreview } from "./image-preview";

// Cap on cached path-resolution results. Like osc8.ts's MAX_TRACKED_RANGES,
// this keeps a long-lived terminal from growing the cache without bound; oldest
// entries fall off via FIFO eviction.
const MAX_CACHE = 5_000;

/** How many rows of a single wrapped logical line we are willing to stitch.
 *  A path long enough to wrap needs the rows joined before it can be matched
 *  at all, but a pathological line (minified JSON, a base64 blob) can wrap
 *  over hundreds of rows, and provideLinks runs per visible row on every
 *  hover. Capping keeps that work bounded; overshooting the cap only costs a
 *  truncated candidate, which then fails the existence check and goes
 *  un-underlined exactly as it does today. */
const MAX_WRAP_ROWS = 16;

/** How far above and below the hovered row to look for a path a TUI broke
 *  across its own indented wrap. Matches MAX_CHAIN_ROWS in
 *  file-path-continuation.ts, less the row that starts the chain. */
const CHAIN_SPAN = 7;

/** Join the rows of the wrapped logical line that `bufferLineNumber` sits in,
 *  and report the absolute 0-based index of its first row.
 *
 *  xterm marks a row that continues its predecessor with isWrapped, and such a
 *  row's predecessor fills every column, so concatenating the untrimmed rows
 *  reproduces the original text with offsets that map straight back onto cells.
 *  Only the final row is trimmed. Like the rest of this module the mapping
 *  assumes one character per cell, so a double-width glyph ahead of a path on
 *  the same logical line shifts the underline; paths are ASCII in practice. */
function readLogicalLine(
  term: Terminal,
  bufferLineNumber: number,
): { text: string; startY: number } | null {
  const buf = term.buffer.active;
  const index = bufferLineNumber - 1;
  if (!buf.getLine(index)) return null;

  let startY = index;
  while (startY > 0 && index - startY < MAX_WRAP_ROWS) {
    if (!buf.getLine(startY)?.isWrapped) break;
    startY--;
  }

  let endY = startY;
  while (endY - startY < MAX_WRAP_ROWS) {
    if (!buf.getLine(endY + 1)?.isWrapped) break;
    endY++;
  }

  const parts: string[] = [];
  for (let y = startY; y <= endY; y++) {
    const line = buf.getLine(y);
    if (!line) break;
    parts.push(line.translateToString(y === endY));
  }
  return { text: parts.join(""), startY };
}

/** Make existing file paths in terminal output clickable: hovering underlines
 *  paths that resolve to a real file/dir on disk. Cmd+click opens the target in
 *  the OS default app for its type (your editor for code, Preview for images,
 *  Finder for folders); Cmd+Shift+click reveals it in Finder. Relative paths
 *  resolve against the shell's current working directory, supplied lazily via
 *  `getCwd` so the freshest OSC 7 value is used at hover time.
 *
 *  The link provider and its cache live for the Terminal's lifetime and are
 *  released by term.dispose() — no separate teardown needed (same as the OSC 8
 *  provider in osc8.ts). */
export function attachFilePathLinks(
  term: Terminal,
  getCwd: () => string | null,
  preview?: Pick<ImagePreview, "show" | "hide">,
): void {
  // Map of "<cwd>\0<raw>" -> resolved absolute path, or null when the path does
  // not exist. Caching avoids a backend round-trip on every re-hover.
  const cache = new Map<string, string | null>();

  async function resolveCached(raw: string, cwd: string | null): Promise<string | null> {
    const key = (cwd ?? "") + "\0" + raw;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let resolved: string | null = null;
    try {
      resolved = await invoke<string | null>("resolve_existing_path", { raw, cwd });
    } catch {
      resolved = null;
    }
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, resolved);
    return resolved;
  }

  /** Build the xterm link for one already-resolved path, given its range on
   *  the row being asked about. Shared by the three ways a path can be found:
   *  plain on one row, stitched across rows xterm wrapped, or joined across a
   *  TUI's own hanging-indent wrap. */
  function makeLink(
    range: { start: { x: number; y: number }; end: { x: number; y: number } },
    text: string,
    resolved: string,
  ) {
    return {
      range,
      text,
      // Hovering an image shows a thumbnail at the pointer. Only images get
      // the handlers, so hovering ordinary paths costs nothing.
      ...(preview && isPreviewableImage(resolved)
        ? {
            hover: (event: MouseEvent) => {
              void preview.show(resolved, {
                x: event.clientX,
                y: event.clientY,
              });
            },
            leave: () => preview.hide(),
          }
        : {}),
      // Gate on Cmd to match Kimbo's URL/OSC 8 link behavior and to avoid
      // hijacking normal text selection. Cmd opens in the default app;
      // Cmd+Shift reveals in Finder.
      activate: (event: MouseEvent) => {
        const action = choosePathAction(event);
        // Take any thumbnail down first, so it does not hang over the
        // terminal while Preview or Finder comes up on top of it.
        if (action !== "none") preview?.hide();
        switch (action) {
          case "open":
            openPath(resolved).catch((e) =>
              console.error("openPath failed:", e),
            );
            break;
          case "reveal":
            revealItemInDir(resolved).catch((e) =>
              console.error("revealItemInDir failed:", e),
            );
            break;
        }
      },
    };
  }

  /** A single row's text, right-trimmed. Trimming only the right keeps every
   *  column index aligned with its cell. */
  function rowText(y: number): string | null {
    return term.buffer.active.getLine(y)?.translateToString(true) ?? null;
  }

  // xterm fires a link's `leave` on mouse-out and when the hovered cell
  // changes, but not when the wheel scrolls the buffer under a pointer that
  // has not moved. Without this the thumbnail would hang over whatever output
  // scrolled into its place.
  if (preview) term.onScroll(() => preview.hide());

  term.registerLinkProvider({
    async provideLinks(bufferLineNumber, callback) {
      const cwd = getCwd();
      const cols = term.cols;
      const index = bufferLineNumber - 1;
      const links: ReturnType<typeof makeLink>[] = [];

      // Whether a range on this row is already spoken for. xterm uses the
      // first link it finds for a position and drops the rest, so a link only
      // gets added when nothing more specific already covers those cells.
      const covered = (startX: number, endX: number): boolean =>
        links.some((l) => startX <= l.range.end.x && endX >= l.range.start.x);

      // --- Paths a TUI broke across its own hanging-indent wrap -------------
      // None of those rows carries xterm's wrapped flag, so the plain pass
      // below sees a first row whose path does not exist and continuation
      // rows with no slash in them. Look at a window of plain rows around
      // this one and let the disk settle it: a chain is linked only when its
      // first fragment does not resolve on its own and some prefix of the
      // joined fragments does.
      //
      // This runs BEFORE the plain pass because a continuation row's own
      // token can itself be a real relative path ("uments/x.png" next to a
      // cwd that has one). The joined absolute path is what the reader meant,
      // so it has to be the link xterm finds first.
      const isHardWrapped = (y: number): boolean =>
        term.buffer.active.getLine(y)?.isWrapped === true;

      // Walk back over plain rows so a chain that started above this one is
      // still found, stopping at a row xterm wrapped (that belongs to the
      // stitching pass, and a chain must not cross it).
      let from = index;
      while (from > 0 && index - from < CHAIN_SPAN && !isHardWrapped(from)) {
        from--;
      }
      const texts: string[] = [];
      for (let y = from; y <= index + CHAIN_SPAN; y++) {
        if (y > from && isHardWrapped(y)) break;
        const text = rowText(y);
        if (text === null) break;
        texts.push(text);
      }

      for (const chain of detectContinuationChains(texts, index - from)) {
        // Every prefix of the chain, plus the first fragment on its own. They
        // are independent questions for the disk, so ask them all at once: a
        // deep chain asked serially is a visible stall before the underline
        // appears, and all but one of the answers is "no".
        const prefixes: string[] = [chain.pieces[0].raw];
        for (let n = 1; n < chain.pieces.length; n++) {
          prefixes.push(prefixes[n - 1] + chain.pieces[n].raw);
        }
        const resolutions = await Promise.all(
          prefixes.map((path) => resolveCached(path, cwd)),
        );

        // A fragment that exists on its own was printed whole, not broken.
        if (resolutions[0]) continue;

        // Take the LONGEST prefix that resolves, not the shortest. Every
        // "/"-boundary prefix of a real path is a real directory, so a break
        // that lands on one resolves early: stopping there would open the
        // containing folder, show no thumbnail (a directory is not an image)
        // and leave the rest of the path unlinked.
        let best: { pieces: number; path: string; resolved: string } | null = null;
        for (let n = 1; n < prefixes.length; n++) {
          const resolved = resolutions[n];
          if (resolved) best = { pieces: n + 1, path: prefixes[n], resolved };
        }
        if (!best) continue;

        // Underline every fragment of the path that lies on this row.
        for (const piece of chain.pieces.slice(0, best.pieces)) {
          if (from + piece.row !== index) continue;
          links.push(
            makeLink(
              {
                start: { x: piece.startCol + 1, y: bufferLineNumber },
                end: { x: piece.endCol, y: bufferLineNumber },
              },
              best.path,
              best.resolved,
            ),
          );
        }
        // Every row of an indent block looks like it could start a chain of
        // its own, so without stopping here a deep block would multiply the
        // lookups by its height for no new links.
        if (links.length > 0) break;
      }

      // --- Plain paths, including ones xterm wrapped itself ----------------
      // bufferLineNumber is the 1-based absolute buffer line (same coordinate
      // as IBufferCellPosition.y). Detection runs over the whole wrapped
      // logical line, not just this row, so a path long enough to wrap is
      // matched in one piece; each resolved candidate is then clipped back to
      // the row being asked about.
      const logical = readLogicalLine(term, bufferLineNumber);
      if (logical) {
        const candidates = detectFilePaths(logical.text);
        const resolutions = await Promise.all(
          candidates.map((c) => resolveCached(c.raw, cwd)),
        );
        for (const [i, c] of candidates.entries()) {
          const resolved = resolutions[i];
          if (!resolved) continue; // path doesn't exist — no underline
          // Offsets into the stitched text map onto cells by whole rows of
          // term.cols. clipLinkRangeForLine (shared with the OSC 8 provider)
          // turns the resulting multi-row span into this row's IBufferRange,
          // which is 1-based and inclusive of both ends; a candidate's endCol
          // is the exclusive 0-based end, so the last cell is endCol - 1.
          const lastCell = c.endCol - 1;
          const range = clipLinkRangeForLine(
            {
              startY: logical.startY + Math.floor(c.startCol / cols),
              startX: c.startCol % cols,
              endY: logical.startY + Math.floor(lastCell / cols),
              endX: (lastCell % cols) + 1,
            },
            bufferLineNumber,
            cols,
          );
          if (!range) continue;
          if (covered(range.start.x, range.end.x)) continue;
          links.push(makeLink(range, c.raw, resolved));
        }
      }

      callback(links.length > 0 ? links : undefined);
    },
  });
}
