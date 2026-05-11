// Pure helpers for filtering the Appearances theme grids by name, author,
// or color. No DOM access — unit-testable in isolation.

import type { UnifiedTheme } from "./settings-types";

export type ThemeMode = "all" | "dark" | "light";

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

// Color-word → HSL hue predicate. Saturation gate keeps grey backgrounds /
// foregrounds from accidentally matching every color word.
const MIN_SATURATION = 25;

const COLOR_RANGES: Record<string, (h: number) => boolean> = {
  red:    (h) => h >= 345 || h <= 15,
  orange: (h) => h > 15 && h <= 45,
  yellow: (h) => h > 45 && h <= 65,
  green:  (h) => h > 65 && h <= 170,
  cyan:   (h) => h > 170 && h <= 200,
  blue:   (h) => h > 200 && h <= 250,
  purple: (h) => h > 250 && h <= 290,
  pink:   (h) => h > 290 && h < 345,
  warm:   (h) => (h >= 0 && h <= 65) || h >= 340,
  cool:   (h) => h > 65 && h <= 250,
};

/** True iff `color` is one of the bucket words the search recognises.
 *  Exact-token only — `greenish` returns false. */
export function isColorWord(color: string): boolean {
  return Object.prototype.hasOwnProperty.call(COLOR_RANGES, color);
}

/** True iff the swatch's hue falls in `color`'s range AND its saturation
 *  is at least MIN_SATURATION. Returns false for unknown colors and for
 *  malformed hex input. */
export function swatchMatchesColor(hex: string, color: string): boolean {
  const hsl = hexToHsl(hex);
  if (!hsl) return false;
  if (hsl.s < MIN_SATURATION) return false;
  const check = COLOR_RANGES[color];
  if (!check) return false;
  return check(hsl.h);
}

/** Filter a theme list by free-text query plus a hard mode chip.
 *  - mode "all" passes every theme through.
 *  - mode "dark"/"light" drops themes whose theme_type doesn't match.
 *  - empty query (after trim) returns the mode-filtered list as-is.
 *  - non-empty query: split on whitespace, theme matches iff EVERY token
 *    matches via name/author substring OR color-word against accent/cursor.
 *  All comparisons are case-insensitive.
 */
export function filterThemes(
  themes: UnifiedTheme[],
  query: string,
  mode: ThemeMode,
): UnifiedTheme[] {
  let out = themes;
  if (mode !== "all") {
    out = out.filter((t) => t.theme_type === mode);
  }
  const q = query.trim().toLowerCase();
  if (q.length === 0) return out;
  // Query matching arrives in the next task.
  return out;
}
