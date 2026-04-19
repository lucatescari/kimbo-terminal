/** Parse an OSC 7 payload (`file://hostname/path`) and return the decoded
 *  path. Returns null for invalid input — the caller should ignore null. */
export function parseOsc7Cwd(payload: string): string | null {
  if (!payload || !payload.startsWith("file://")) return null;
  // Strip "file://" then strip optional hostname up to the next "/".
  const afterScheme = payload.slice("file://".length);
  const slashIdx = afterScheme.indexOf("/");
  if (slashIdx < 0) return null;
  const path = afterScheme.slice(slashIdx);
  if (!path) return null;
  try {
    const decoded = decodeURIComponent(path);
    return decoded || null;
  } catch {
    return null;
  }
}
