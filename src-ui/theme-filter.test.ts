import { describe, expect, it } from "vitest";
import {
  hexToHsl,
  swatchMatchesColor,
  isColorWord,
  filterThemes,
  type ThemeMode,
} from "./theme-filter";
import type { UnifiedTheme } from "./settings-types";

function mkTheme(over: Partial<UnifiedTheme> = {}): UnifiedTheme {
  return {
    slug: "t",
    name: "Sample",
    theme_type: "dark",
    author: "@me",
    version: "1.0",
    swatches: {
      background: "#101010",
      foreground: "#eeeeee",
      accent: "#6ABE6A",
      cursor: "#6ABE6A",
    },
    source: "Builtin",
    active: false,
    ...over,
  };
}

describe("hexToHsl", () => {
  it("converts pure red", () => {
    const hsl = hexToHsl("#ff0000")!;
    expect(hsl.h).toBeCloseTo(0, 1);
    expect(hsl.s).toBeCloseTo(100, 1);
    expect(hsl.l).toBeCloseTo(50, 1);
  });

  it("converts pure green (hue 120)", () => {
    const hsl = hexToHsl("#00ff00")!;
    expect(hsl.h).toBeCloseTo(120, 1);
  });

  it("converts pure blue (hue 240)", () => {
    const hsl = hexToHsl("#0000ff")!;
    expect(hsl.h).toBeCloseTo(240, 1);
  });

  it("treats a mid-grey as zero saturation", () => {
    const hsl = hexToHsl("#888888")!;
    expect(hsl.s).toBeCloseTo(0, 1);
  });

  it("accepts hex without a leading #", () => {
    expect(hexToHsl("ff0000")).not.toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(hexToHsl("")).toBeNull();
    expect(hexToHsl("not-a-color")).toBeNull();
    expect(hexToHsl("#ff00")).toBeNull();
    expect(hexToHsl("#gggggg")).toBeNull();
  });
});

describe("swatchMatchesColor", () => {
  it("matches a clearly green hex against 'green'", () => {
    expect(swatchMatchesColor("#6ABE6A", "green")).toBe(true);
  });

  it("does not match low-saturation greys against any color", () => {
    expect(swatchMatchesColor("#888888", "green")).toBe(false);
    expect(swatchMatchesColor("#222222", "blue")).toBe(false);
  });

  it("matches a red hex against 'warm' but not 'cool'", () => {
    expect(swatchMatchesColor("#E03030", "warm")).toBe(true);
    expect(swatchMatchesColor("#E03030", "cool")).toBe(false);
  });

  it("matches a blue hex against 'cool' but not 'warm'", () => {
    expect(swatchMatchesColor("#3050E0", "cool")).toBe(true);
    expect(swatchMatchesColor("#3050E0", "warm")).toBe(false);
  });

  it("returns false for unknown color words", () => {
    expect(swatchMatchesColor("#E03030", "magenta-ish")).toBe(false);
    expect(swatchMatchesColor("#E03030", "greenish")).toBe(false);
  });

  it("returns false for malformed hex", () => {
    expect(swatchMatchesColor("not-hex", "green")).toBe(false);
  });
});

describe("isColorWord", () => {
  it("recognises the bucket words", () => {
    for (const w of ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "warm", "cool"]) {
      expect(isColorWord(w)).toBe(true);
    }
  });

  it("rejects non-color words and partial matches", () => {
    expect(isColorWord("forest")).toBe(false);
    expect(isColorWord("greenish")).toBe(false);
    expect(isColorWord("")).toBe(false);
  });
});

describe("filterThemes — empty query + mode", () => {
  const dark1 = mkTheme({ slug: "d1", theme_type: "dark" });
  const dark2 = mkTheme({ slug: "d2", theme_type: "dark" });
  const light1 = mkTheme({ slug: "l1", theme_type: "light" });
  const all = [dark1, dark2, light1];

  it("returns input unchanged for empty query and mode=all", () => {
    expect(filterThemes(all, "", "all")).toEqual(all);
  });

  it("treats whitespace-only query as empty", () => {
    expect(filterThemes(all, "   ", "all")).toEqual(all);
  });

  it("mode=dark drops light themes", () => {
    expect(filterThemes(all, "", "dark")).toEqual([dark1, dark2]);
  });

  it("mode=light drops dark themes", () => {
    expect(filterThemes(all, "", "light")).toEqual([light1]);
  });

  it("returns empty array for empty input", () => {
    expect(filterThemes([], "", "all")).toEqual([]);
  });
});
