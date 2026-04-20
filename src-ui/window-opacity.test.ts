// @vitest-environment jsdom
//
// CSS audit: every chrome surface in the window (anything that paints
// between the webview and the user's terminal text) must participate in
// the --app-alpha translucency pipeline. Either:
//
//   - background: transparent;                  → lets #app-frame's alpha show
//   - background: color-mix(in srgb, <color>
//       calc(var(--app-alpha, 1) * 100%),
//       transparent);                           → scales with the slider
//
// If a chrome surface paints a bare `background: var(--bg*)` it masks the
// slider and the whole opacity feature looks broken.
//
// Overlay surfaces (settings modal, welcome popup, inline code blocks,
// font preview) are deliberately opaque for readability and are allowlisted.
// Anything else paints chrome and must be alpha-aware.
//
// This test caught two regressions:
//   1. Initial landing left #tab-bar / .pane / .pane-head / #status-bar
//      painting opaque fills over #app-frame, so only the 36px title bar
//      was actually translucent.
//   2. Future developers adding a new chrome element and grabbing the
//      handy var(--bg) token for its background would silently reintroduce
//      the same masking.

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "style.css"),
  "utf-8",
);

/** Remove /* ... *\/ block comments so regex scans don't match example text. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split the flat top-level CSS into `{selector, body}` pairs. The project
 *  style.css has no nested @media / @supports / @container blocks, so a
 *  straightforward two-sided brace match is sufficient. */
function extractRules(css: string): Array<{ selector: string; body: string }> {
  const stripped = stripComments(css);
  const rules: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

// Selectors where an opaque chrome-token fill is intentional because the
// surface is an overlay rendered above the translucent chrome.
const OPAQUE_OVERLAY_SELECTORS = new Set<string>([
  ".settings",
  ".settings .side",
  ".welcome",
  ".codeblock",
  ".font-preview",
]);

// Tokens that represent the window-chrome base color. A bare reference to
// any of these in `background: var(--X)` will mask --app-alpha. Other
// --bg-* tokens (--bg-elevated, --bg-hover, --bg-active, --bg-input) are
// for overlays, interactive states, and inputs — out of scope for chrome
// translucency.
const CHROME_TOKENS = [
  "--bg",
  "--bg-tabs",
  "--bg-pane",
  "--bg-titlebar",
  "--bg-sidebar",
];

const CHROME_TOKEN_RE = new RegExp(
  String.raw`background\s*:\s*var\(\s*(` +
    CHROME_TOKENS.map((t) => t.replace(/-/g, "\\-")).join("|") +
    String.raw`)\s*\)\s*;`,
);

describe("window opacity: no opaque chrome surfaces", () => {
  it("every bare chrome-token fill lives inside an allowlisted overlay", () => {
    const rules = extractRules(CSS);
    const offending: Array<{ selector: string; snippet: string }> = [];

    for (const { selector, body } of rules) {
      const m = CHROME_TOKEN_RE.exec(body);
      if (!m) continue;
      offending.push({ selector, snippet: m[0] });
    }

    const unexpected = offending.filter(
      (o) => !OPAQUE_OVERLAY_SELECTORS.has(o.selector),
    );

    expect(
      unexpected,
      `Found opaque chrome backgrounds that will mask --app-alpha:\n` +
        unexpected.map((u) => `  ${u.selector} → ${u.snippet}`).join("\n") +
        `\n\nEvery chrome surface must use 'background: transparent' or ` +
        `'color-mix(in srgb, <color> calc(var(--app-alpha, 1) * 100%), transparent)'. ` +
        `If this is an intentional overlay, add the selector to ` +
        `OPAQUE_OVERLAY_SELECTORS in window-opacity.test.ts.`,
    ).toEqual([]);
  });

  it("each known chrome surface is alpha-aware or transparent", () => {
    // Known surfaces inside #app-frame that paint something. If you add a
    // new chrome element (header strip, footer ribbon, split divider with a
    // fill…) add it here too — and back it with `transparent` or the
    // color-mix pattern before landing.
    const chromeSurfaces: Array<{ selector: string; label: string }> = [
      { selector: "#app-frame", label: "app frame" },
      { selector: "#title-bar", label: "title bar" },
      { selector: "#tab-bar", label: "tab bar" },
      { selector: "#status-bar", label: "status bar" },
      { selector: ".pane", label: "pane" },
      { selector: ".pane-head", label: "pane head" },
    ];

    const rules = extractRules(CSS);

    for (const { selector, label } of chromeSurfaces) {
      // A selector can appear in multiple rule blocks (e.g., #title-bar has
      // one block for border-radius and another for layout + background).
      // Look through all matching blocks and find the one that declares
      // `background`.
      const matchingRules = rules.filter((r) => r.selector === selector);
      expect(
        matchingRules.length,
        `${label}: no rule blocks found for ${selector}`,
      ).toBeGreaterThan(0);

      let bgMatch: RegExpExecArray | null = null;
      for (const r of matchingRules) {
        const m = /background\s*:\s*([^;]+);/.exec(r.body);
        if (m) {
          bgMatch = m;
          break;
        }
      }
      expect(
        bgMatch,
        `${label}: no background declaration found in any ${selector} block`,
      ).not.toBeNull();

      const bg = bgMatch![1].trim().replace(/\s+/g, " ");
      const isTransparent = bg === "transparent";
      const isAlphaAware = /color-mix\(\s*in srgb,[\s\S]*var\(\s*--app-alpha/.test(bg);

      expect(
        isTransparent || isAlphaAware,
        `${label}: background on ${selector} must be 'transparent' or a ` +
          `color-mix(in srgb, ..., var(--app-alpha) ...) expression so ` +
          `the translucency slider takes effect. Got: "${bg}"`,
      ).toBe(true);
    }
  });
});
