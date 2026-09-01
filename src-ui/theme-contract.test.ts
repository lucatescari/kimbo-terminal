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

import { applyTheme, registerTerminal, unregisterTerminal } from "./theme";

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

describe("theme contract: xterm theme mapping", () => {
  /** Captures what applyTheme hands a terminal, without needing a real one. */
  function captureTheme(): { options: { theme?: Record<string, string> } } {
    return { options: {} };
  }

  it("hands xterm exactly the keys the contract claims, no more and no fewer", () => {
    // The theme creator builds its preview's ITheme from the contract. Before
    // xtermKey existed it reconstructed these names by convention — strip
    // "ansi_", camel-case the rest — and nothing tied that guess to this
    // literal. An xterm rename would have updated the app, passed the sync
    // (which only compares majors), been silently ignored by xterm, and left
    // the preview showing a colour the app no longer used.
    const term = captureTheme();
    registerTerminal(term as never);
    applyTheme(distinctTheme() as never);
    unregisterTerminal(term as never);

    const claimed = contract.keys
      .filter((k: { xtermKey?: string }) => k.xtermKey)
      .map((k: { xtermKey: string }) => k.xtermKey)
      .sort();
    expect(Object.keys(term.options.theme ?? {}).sort()).toEqual(claimed);
  });

  it("fills each xterm key from the theme field the contract names", () => {
    const theme = distinctTheme();
    const term = captureTheme();
    registerTerminal(term as never);
    applyTheme(theme as never);
    unregisterTerminal(term as never);

    for (const k of contract.keys) {
      if (!k.xtermKey) continue;
      // background is the one computed value: it is tinted by the
      // background-opacity preference rather than copied through.
      if (k.xtermKey === "background") continue;
      expect(
        term.options.theme?.[k.xtermKey],
        `xterm's ${k.xtermKey} should carry ${k.resolvedField} (from ${k.key})`,
      ).toBe(theme[k.resolvedField]);
    }
  });

  it("only maps terminal colours — window chrome is CSS, never terminal state", () => {
    for (const k of contract.keys) {
      if (k.group === "chrome") expect(k.xtermKey).toBeUndefined();
      else expect(k.xtermKey, `${k.key} should map to an xterm key`).toBeTruthy();
    }
  });
});

describe("theme contract: every CSS variable is consumed by style.css", () => {
  // The write side is already pinned above: applyTheme sets exactly the
  // variables the contract claims. This is the read side: a variable that
  // style.css never references is a theme key that renders nothing — the
  // April 2026 redesign left four chrome keys dead exactly this way, and
  // every published theme kept setting them for months with no effect.
  //
  // What this guard can and cannot see: it is a TEXTUAL scan and it is NOT
  // transitive. --tab-bar-bg counts as read only because of the one-hop
  // `--bg-tabs: var(--tab-bar-bg)` indirection in :root; a variable read only
  // two hops away, or read in the *wrong* rule, passes just the same. The
  // semantic guard for the chrome surfaces — that each token actually paints
  // the surface it is meant to — is theme-chrome-tokens.browser.test.ts,
  // which measures painted colours in a real Chromium. Both are needed: this
  // one catches a key with no reader at all, that one catches a key with the
  // wrong reader.
  //
  // An EXEMPT entry is a recorded design decision about a variable that CSS
  // is not supposed to read — never a way to silence the guard when a key
  // turns out to be dead. Wiring a variable into an arbitrary rule just to
  // clear this list is the same bug in the other direction.
  //   --accent-blue: written on purpose without a current reader; pinned as
  //     still-written by theme-accent-controls.browser.test.ts ("keeps
  //     --accent-blue itself wired to ANSI blue").
  //   --cursor: terminal.cursor reaches the terminal through xterm's ITheme,
  //     not through CSS, so no rule should read it. It is chosen to work as a
  //     large filled block on the terminal background; borrowing it for a 1px
  //     UI caret dropped catppuccin-latte to 2.34:1 against --bg-input,
  //     under WCAG 1.4.11's 3:1 for non-text indicators.
  const EXEMPT = new Set<string>(["--accent-blue", "--cursor"]);

  it("reads every variable a theme key feeds, so no key is silently dead", () => {
    // Strip comments first: a variable mentioned only inside a CSS comment is
    // not read by anything. style.css has a `var(--bg)` in prose today.
    const css = readFileSync(resolve(__dirname, "style.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

    const dead: string[] = [];
    for (const k of contract.keys) {
      for (const cssVar of k.cssVars as string[]) {
        if (EXEMPT.has(cssVar)) continue;
        const used = css.includes(`var(${cssVar})`) || css.includes(`var(${cssVar},`);
        if (!used) dead.push(`${cssVar} (from ${k.key})`);
      }
    }

    expect(
      dead,
      "applyTheme writes these variables but style.css never reads them, " +
        "so the theme keys behind them do nothing. Wire each one into a " +
        "rule or a derived token — or, only for a deliberate decision " +
        "recorded in a test, add it to EXEMPT above.",
    ).toEqual([]);
  });
});
