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
