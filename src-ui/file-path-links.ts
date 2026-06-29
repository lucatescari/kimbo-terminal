import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { detectFilePaths } from "./file-path-detect";
import { choosePathAction } from "./file-path-action";

// Cap on cached path-resolution results. Like osc8.ts's MAX_TRACKED_RANGES,
// this keeps a long-lived terminal from growing the cache without bound; oldest
// entries fall off via FIFO eviction.
const MAX_CACHE = 5_000;

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
export function attachFilePathLinks(term: Terminal, getCwd: () => string | null): void {
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

  term.registerLinkProvider({
    async provideLinks(bufferLineNumber, callback) {
      // bufferLineNumber is the 1-based absolute buffer line (same coordinate
      // as IBufferCellPosition.y), so getLine takes the 0-based index.
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) return callback(undefined);
      const candidates = detectFilePaths(line.translateToString(true));
      if (candidates.length === 0) return callback(undefined);

      const cwd = getCwd();
      const links = [];
      for (const c of candidates) {
        const resolved = await resolveCached(c.raw, cwd);
        if (!resolved) continue; // path doesn't exist — no underline
        links.push({
          // xterm IBufferRange is 1-based and inclusive of both ends. The
          // candidate's endCol is the exclusive 0-based end, which equals the
          // 1-based inclusive end column.
          range: {
            start: { x: c.startCol + 1, y: bufferLineNumber },
            end: { x: c.endCol, y: bufferLineNumber },
          },
          text: c.raw,
          // Gate on Cmd to match Kimbo's URL/OSC 8 link behavior and to avoid
          // hijacking normal text selection. Cmd opens in the default app;
          // Cmd+Shift reveals in Finder.
          activate: (event: MouseEvent) => {
            switch (choosePathAction(event)) {
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
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  });
}
