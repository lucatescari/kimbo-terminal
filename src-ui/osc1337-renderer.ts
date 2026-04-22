import type { Terminal } from "@xterm/xterm";
import {
  decodeBase64Bytes,
  parseOsc1337InlineImage,
  resolveImageLayout,
  sniffBitmapFormat,
} from "./osc1337";

export interface AttachOptions {
  onImageClick?: (blobUrl: string) => void;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Attach the OSC 1337 inline-image handler to a terminal.
 *
 *  Anchoring is delegated to xterm's built-in decoration API: each image
 *  gets a marker and a decoration sized in cells, and xterm handles all
 *  scroll, resize, and clip updates for us. The old approach hand-rolled
 *  the overlay math with its own scroll/resize observers and kept drifting
 *  out of sync with xterm's own renderer — decorations are the supported
 *  primitive for "pin a DOM element to a buffer cell" and xterm uses them
 *  internally for selection, decorations, and the minimap. */
export function attachOsc1337Renderer(
  term: Terminal,
  container: HTMLElement,
  opts: AttachOptions = {},
): () => void {
  const fallbackMarker = (
    parsed: NonNullable<ReturnType<typeof parseOsc1337InlineImage>>,
    reason?: string,
  ): void => {
    const fileLabel = parsed.name || "image";
    const geometry = [parsed.width, parsed.height].filter(Boolean).join("x") || "auto";
    const sizeLabel = parsed.size != null ? `${parsed.size} bytes` : "unknown size";
    const suffix = reason ? `, ${reason}` : "";
    term.write(`\r\n[inline image: ${fileLabel}, ${geometry}, ${sizeLabel}${suffix}]\r\n`);
  };

  const renderImage = async (
    parsed: NonNullable<ReturnType<typeof parseOsc1337InlineImage>>,
    base64: string,
    marker: ReturnType<Terminal["registerMarker"]>,
    markerColumn: number,
  ): Promise<void> => {
    if (!marker) return fallbackMarker(parsed, "marker failed");

    const bytes = decodeBase64Bytes(base64, MAX_BYTES);
    if (!bytes) {
      marker.dispose();
      return fallbackMarker(parsed, "too large or invalid");
    }
    const format = sniffBitmapFormat(bytes);
    if (!format) {
      marker.dispose();
      return fallbackMarker(parsed, "unsupported format");
    }

    const blob = new Blob([bytes as BlobPart], { type: `image/${format}` });
    const blobUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");
    const naturalReady = new Promise<{ width: number; height: number }>((resolve, reject) => {
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("decode failed"));
    });
    img.src = blobUrl;

    let natural: { width: number; height: number };
    try {
      natural = await naturalReady;
    } catch {
      URL.revokeObjectURL(blobUrl);
      marker.dispose();
      return fallbackMarker(parsed, "decode failed");
    }

    const cell = getCellDims(term);
    if (!cell) {
      URL.revokeObjectURL(blobUrl);
      marker.dispose();
      return fallbackMarker(parsed, "terminal not ready");
    }

    const layout = resolveImageLayout(
      {
        width: parsed.width,
        height: parsed.height,
        preserveAspectRatio: parsed.preserveAspectRatio,
      },
      natural,
      cell,
      { width: container.clientWidth, height: container.clientHeight },
    );

    // Decoration size is cell-granular. Round up so the decoration fully
    // contains the image's pixel box; the <img> inside keeps its exact
    // pixel dimensions so aspect ratio is preserved.
    const widthCells = Math.max(1, Math.ceil(layout.pxWidth / cell.width));
    const heightCells = layout.rowsToReserve;

    img.style.width = `${layout.pxWidth}px`;
    img.style.height = `${layout.pxHeight}px`;
    img.style.display = "block";
    img.style.pointerEvents = "auto";
    img.style.userSelect = "none";
    img.alt = parsed.name || "inline image";
    if (opts.onImageClick) {
      img.addEventListener("click", (ev) => {
        if (!ev.metaKey) return;
        opts.onImageClick?.(blobUrl);
      });
    }

    const decoration = term.registerDecoration({
      marker,
      x: markerColumn,
      width: widthCells,
      height: heightCells,
      layer: "top",
    });
    if (!decoration) {
      URL.revokeObjectURL(blobUrl);
      marker.dispose();
      return fallbackMarker(parsed, "decoration failed");
    }

    let appended = false;
    decoration.onRender((el) => {
      if (!appended) {
        // Let the <img> extend past the cell grid on both axes — cell
        // rounding can truncate the last row/column by a fraction of a
        // pixel, which would otherwise clip the image visibly.
        el.style.overflow = "visible";
        el.style.pointerEvents = "none";
        el.appendChild(img);
        appended = true;
      }
    });

    decoration.onDispose(() => {
      URL.revokeObjectURL(blobUrl);
    });
  };

  const oscHandler = (data: string): boolean => {
    const parsed = parseOsc1337InlineImage(data);
    if (!parsed) return false;
    if (!parsed.inline) {
      fallbackMarker(parsed, "download-only, not rendered");
      return true;
    }
    const colon = data.indexOf(":");
    const base64 = colon >= 0 ? data.slice(colon + 1) : "";
    // Snapshot the cursor column synchronously at OSC arrival — later bytes
    // in the same parser chunk can move the cursor, and the decoration's
    // `x` anchor is captured at registration time.
    const markerColumn = term.buffer.active.cursorX;
    const marker = term.registerMarker(0);
    void renderImage(parsed, base64, marker, markerColumn);
    return true;
  };

  const oscDisposable = term.parser.registerOscHandler(1337, oscHandler);

  return () => {
    oscDisposable.dispose();
    // Decorations/markers are tracked by xterm and are cleaned up when
    // the terminal disposes. No manual overlay teardown to do.
  };
}

/** Read cell dimensions from xterm's internal render service. This is the
 *  single source of truth used by xterm itself for both DOM and WebGL
 *  renderers — undocumented but stable in xterm 5.x (also used by the
 *  accessibility and decoration layers). */
function getCellDims(term: Terminal): { width: number; height: number } | null {
  const svc = (term as unknown as {
    _core?: {
      _renderService?: {
        dimensions?: { css?: { cell?: { width?: number; height?: number } } };
      };
    };
  })._core?._renderService;
  const cell = svc?.dimensions?.css?.cell;
  if (cell && cell.width && cell.height) {
    return { width: cell.width, height: cell.height };
  }
  return null;
}
