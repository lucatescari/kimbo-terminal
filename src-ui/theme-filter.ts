// Pure helpers for filtering the Appearances theme grids by name, author,
// or color. No DOM access — unit-testable in isolation.

/** Convert "#RRGGBB" (with or without the leading #) to HSL where h is
 *  0–360, s and l are 0–100. Returns null for malformed input. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.trim().replace(/^#/, "");
  if (m.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(m)) return null;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
