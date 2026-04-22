export interface Osc1337InlineImage {
  name: string | null;
  width: string | null;
  height: string | null;
  preserveAspectRatio: boolean;
  inline: boolean;
  size: number | null;
}

/** Parse iTerm2 OSC 1337 inline-image payloads:
 *  `File=key=value;key=value:BASE64_DATA`.
 *  Returns metadata even when data is omitted/invalid so callers can still
 *  consume the control sequence and present a fallback marker. */
export function parseOsc1337InlineImage(payload: string): Osc1337InlineImage | null {
  if (!payload || !payload.startsWith("File=")) return null;
  const colon = payload.indexOf(":");
  if (colon < 0) return null;
  const attrsRaw = payload.slice("File=".length, colon);
  const dataRaw = payload.slice(colon + 1);

  const attrs = new Map<string, string>();
  for (const pair of attrsRaw.split(";")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    attrs.set(pair.slice(0, eq), pair.slice(eq + 1));
  }

  const nameB64 = attrs.get("name");
  let name: string | null = null;
  if (nameB64) {
    try {
      name = decodeBase64Text(nameB64);
    } catch {
      name = null;
    }
  }

  const sizeAttr = attrs.get("size");
  const parsedSize = sizeAttr ? Number(sizeAttr) : NaN;
  const estimatedSize = estimateBase64Bytes(dataRaw);

  return {
    name,
    width: attrs.get("width") ?? null,
    height: attrs.get("height") ?? null,
    preserveAspectRatio: attrs.get("preserveAspectRatio") !== "0",
    inline: attrs.get("inline") === "1",
    size: Number.isFinite(parsedSize) ? parsedSize : estimatedSize,
  };
}

function decodeBase64Text(data: string): string {
  return decodeURIComponent(escape(atob(data)));
}

function estimateBase64Bytes(data: string): number | null {
  if (!data) return null;
  const sanitized = data.replace(/\s+/g, "");
  if (!sanitized) return null;
  let padding = 0;
  if (sanitized.endsWith("==")) padding = 2;
  else if (sanitized.endsWith("=")) padding = 1;
  const bytes = Math.floor((sanitized.length * 3) / 4) - padding;
  return bytes >= 0 ? bytes : null;
}

export type BitmapFormat = "png" | "jpeg" | "gif" | "webp";

/** Identify bitmap format by magic bytes. Returns null for anything that
 *  isn't PNG/JPEG/GIF/WebP (including SVG — which is rejected on purpose:
 *  SVG can embed <script> and external fetches, so it must never be
 *  rendered from PTY-sourced content). */
export function sniffBitmapFormat(bytes: Uint8Array): BitmapFormat | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "gif";
  // WebP: "RIFF" ???? "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  return null;
}

/** Decode a base64 string to a Uint8Array, rejecting inputs whose decoded
 *  size would exceed `maxBytes` and inputs that aren't valid base64.
 *  Pre-estimates size from length so we can reject a 1 GB payload before
 *  allocating anything. Tolerates whitespace (OSC payloads sometimes
 *  arrive line-wrapped). */
export function decodeBase64Bytes(data: string, maxBytes: number): Uint8Array | null {
  if (!data) return null;
  const sanitized = data.replace(/\s+/g, "");
  if (!sanitized) return null;
  const estimated = estimateBase64Bytes(sanitized);
  if (estimated == null || estimated > maxBytes) return null;
  try {
    const binary = atob(sanitized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export interface LayoutAttrs {
  width: string | null;
  height: string | null;
  preserveAspectRatio: boolean;
}

export interface ResolvedLayout {
  pxWidth: number;
  pxHeight: number;
  rowsToReserve: number;
}

const MAX_DIM = 4096;

/** Resolve OSC 1337 width/height attrs (cells, Npx, N%, auto) into actual
 *  pixel dimensions plus the number of terminal rows the image should
 *  occupy in the buffer. Pure function: callers provide all measurements. */
export function resolveImageLayout(
  attrs: LayoutAttrs,
  natural: { width: number; height: number },
  cell: { width: number; height: number },
  viewport: { width: number; height: number },
): ResolvedLayout {
  const safeNaturalWidth = Math.max(1, natural.width);
  const safeNaturalHeight = Math.max(1, natural.height);
  const aspect = safeNaturalWidth / safeNaturalHeight;

  const wAxis = {
    unitCell: cell.width,
    unitViewport: viewport.width,
    natural: safeNaturalWidth,
  };
  const hAxis = {
    unitCell: cell.height,
    unitViewport: viewport.height,
    natural: safeNaturalHeight,
  };

  const w = resolveAxis(attrs.width, wAxis);
  const h = resolveAxis(attrs.height, hAxis);

  let pxWidth: number;
  let pxHeight: number;

  if (w != null && h != null) {
    if (attrs.preserveAspectRatio) {
      const scale = Math.min(w / safeNaturalWidth, h / safeNaturalHeight);
      pxWidth = safeNaturalWidth * scale;
      pxHeight = safeNaturalHeight * scale;
    } else {
      pxWidth = w;
      pxHeight = h;
    }
  } else if (w != null) {
    pxWidth = w;
    pxHeight = attrs.preserveAspectRatio ? w / aspect : safeNaturalHeight;
  } else if (h != null) {
    pxHeight = h;
    pxWidth = attrs.preserveAspectRatio ? h * aspect : safeNaturalWidth;
  } else {
    pxWidth = safeNaturalWidth;
    pxHeight = safeNaturalHeight;
  }

  // Keep rendering bounded to the terminal viewport width.
  if (pxWidth > viewport.width) {
    const scale = viewport.width / pxWidth;
    pxWidth = viewport.width;
    pxHeight *= scale;
  }

  // Global sanity cap to avoid giant overlays and layout thrash.
  if (pxHeight > MAX_DIM) {
    const scale = MAX_DIM / pxHeight;
    pxHeight = MAX_DIM;
    pxWidth *= scale;
  }

  pxWidth = Math.max(1, Math.round(pxWidth));
  pxHeight = Math.max(1, Math.round(pxHeight));

  return {
    pxWidth,
    pxHeight,
    rowsToReserve: Math.max(1, Math.ceil(pxHeight / Math.max(1, cell.height))),
  };
}

function resolveAxis(
  value: string | null,
  axis: { unitCell: number; unitViewport: number; natural: number },
): number | null {
  if (value == null || value === "" || value === "auto") return null;
  if (value.endsWith("px")) {
    const n = Number(value.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (value.endsWith("%")) {
    const n = Number(value.slice(0, -1));
    return Number.isFinite(n) ? (n / 100) * axis.unitViewport : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n * axis.unitCell : null;
}

/** Given an image marker line and current viewport top (absolute buffer
 *  line), return the overlay pixel top offset relative to viewport top. */
export function computeOverlayTop(
  args: { markerLine: number; viewportTop: number },
  cell: { width: number; height: number },
): number {
  return (args.markerLine - args.viewportTop) * cell.height;
}
