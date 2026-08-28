// @vitest-environment jsdom
//
// The other half of the contract guarantee. Task 1's Rust test pins the
// defaults to the resolver; this pins the CSS variable mapping to
// applyTheme(). Together they mean theme-contract.json cannot silently fall
// behind the code, which matters because the theme creator site renders its
// preview from that mapping and has no other way to know it changed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ui-prefs", () => ({ getPrefs: () => ({ backgroundOpacity: 100 }) }));

import { applyTheme } from "./theme";

const contract = JSON.parse(
  readFileSync(resolve(__dirname, "..", "theme-contract.json"), "utf-8"),
);

/** A resolved theme where every colour field has a unique, recognisable value,
 *  so we can tell which field ended up in which CSS variable. */
function distinctTheme(): Record<string, string> {
  const t: Record<string, string> = { name: "Test", theme_type: "dark" };
  contract.keys.forEach((k: { resolvedField: string }, i: number) => {
    // #010000, #020000, … — unique per field and a valid hex colour.
    t[k.resolvedField] = "#" + (i + 1).toString(16).padStart(2, "0") + "0000";
  });
  return t;
}

describe("theme contract: CSS variable mapping", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("sets every variable the contract claims, from the field it names", () => {
    const theme = distinctTheme();
    applyTheme(theme as never);

    const root = document.documentElement;
    for (const k of contract.keys) {
      for (const cssVar of k.cssVars) {
        expect(
          root.style.getPropertyValue(cssVar).trim(),
          `${cssVar} should carry ${k.resolvedField} (from ${k.key})`,
        ).toBe(theme[k.resolvedField]);
      }
    }
  });

  it("claims every variable applyTheme actually sets", () => {
    applyTheme(distinctTheme() as never);

    const claimed = new Set<string>(
      contract.keys.flatMap((k: { cssVars: string[] }) => k.cssVars),
    );
    // Variables applyTheme sets that are NOT derived from a single theme
    // colour: theme-type driven design tokens, and anything computed rather
    // than copied. As of this writing, applyTheme's 16 CSS custom properties
    // are all straight copies already covered by the contract, so this set
    // is empty — it exists for the next variable that isn't.
    const exempt = new Set<string>([]);

    const root = document.documentElement;
    const actuallySet: string[] = [];
    for (let i = 0; i < root.style.length; i++) actuallySet.push(root.style[i]);

    const unclaimed = actuallySet.filter(
      (v) => v.startsWith("--") && !claimed.has(v) && !exempt.has(v),
    );
    expect(
      unclaimed,
      "applyTheme sets variables the contract does not describe. Either add " +
        "them to theme-contract.json, or add them to `exempt` above if they " +
        "are computed rather than a straight copy of a theme colour.",
    ).toEqual([]);
  });
});

describe("the chrome accent comes from the theme", () => {
  it("derives --accent from the contract key themes use as their accent", () => {
    // panel.activeBorder is where theme authors put "this is my colour":
    // Claude Red's #d97757, Matrix's #00ff41, Gruvbox's #fabd2f. ANSI blue is
    // just whatever blue the palette happens to carry, and twelve of the
    // published themes set the two differently. If someone re-points --accent
    // at --accent-blue again, the chrome silently stops matching the theme.
    const css = readFileSync(resolve(__dirname, "style.css"), "utf8");
    const declaration = css.match(/^\s*--accent:\s*([^;]+);/m);
    expect(declaration, "style.css must define --accent").not.toBeNull();

    const activeBorder = contract.keys.find(
      (k: { key: string }) => k.key === "panel.activeBorder",
    );
    expect(activeBorder.cssVars.length).toBeGreaterThan(0);
    for (const cssVar of activeBorder.cssVars) {
      expect(declaration![1]).toContain(`var(${cssVar})`);
    }
  });

  it("does not let a preference override the theme's accent", () => {
    // The accent used to be a user preference written inline on :root, which
    // outranked the stylesheet and survived every theme switch.
    const prefs = readFileSync(resolve(__dirname, "ui-prefs.ts"), "utf8");
    expect(prefs).not.toContain('setProperty("--accent"');
    expect(prefs).not.toContain('setProperty("--accent-tint"');
    expect(prefs).not.toContain('setProperty("--accent-strong"');
  });
});
