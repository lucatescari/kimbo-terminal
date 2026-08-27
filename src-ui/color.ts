// Small pure colour helpers.
//
// Split out of theme.ts so modules that only need colour maths — theme-card.ts
// in particular — don't have to import a module that pulls in the Tauri API
// just to convert a hex string.

/** #rgb / #rrggbb → an rgba() string at `alpha`. Falls back to the input
 *  (opaque) if it can't be parsed. */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
