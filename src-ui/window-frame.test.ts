// @vitest-environment jsdom
//
// Tests for the custom window frame (rounded corners, drop shadow).
// Catches the "corners look square" class of bug by:
//   (a) asserting the CSS declares a radius on body + title-bar + status-bar,
//   (b) asserting all three radii match (mismatches cause visible seams),
//   (c) checking the Tauri window config has transparent+decorations-off so
//       the CSS-driven shape is actually the window's visible edge.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Strip CSS block comments first — they can appear between rules and, if
// left in place, taint the selector portion when we parse rule blocks.
const css = readFileSync(resolve(__dirname, "style.css"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const conf = JSON.parse(
  readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf-8"),
) as { app: { windows: Array<Record<string, unknown>> } };

/** Extract every rule block whose selector exactly matches `selector`.
 *
 * Handles comma-list selectors (`html, body { ... }`) by splitting each
 * chunk's selector on commas. Returns the concatenated rule bodies so tests
 * can assert on any declaration regardless of which block it lives in. */
function rulesFor(selector: string): string {
  const out: string[] = [];
  for (const chunk of css.split("}")) {
    const openBrace = chunk.lastIndexOf("{");
    if (openBrace < 0) continue;
    const selPart = chunk.slice(0, openBrace).trim();
    const bodyPart = chunk.slice(openBrace + 1);
    const parts = selPart.split(",").map((s) => s.trim());
    if (parts.includes(selector)) out.push(bodyPart);
  }
  return out.join("\n");
}

function radiusIn(rules: string): number | null {
  // Matches `border-radius: Npx` or any of the four corner variants.
  const all = [...rules.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*(\d+(?:\.\d+)?)px/g)];
  if (all.length === 0) return null;
  const vals = all.map((m) => parseFloat(m[1]));
  // All radius declarations in a rule must agree — otherwise corners mismatch.
  const unique = [...new Set(vals)];
  return unique.length === 1 ? unique[0] : NaN;
}

describe("window frame: rounded container", () => {
  // body + border-radius + overflow:hidden is unreliable on WebKit/macOS —
  // overflow propagates to html and clipping misbehaves. The rounded shape
  // MUST be on a dedicated wrapper (#app-frame) that is not html or body.
  const frameR = radiusIn(rulesFor("#app-frame"));
  const titleR = radiusIn(rulesFor("#title-bar"));
  const statusR = radiusIn(rulesFor("#status-bar"));

  it("#app-frame declares a border-radius (rounded shape lives on a wrapper, NOT on body)", () => {
    expect(frameR, "the rounded container must be #app-frame").not.toBeNull();
  });

  it("title bar declares a border-radius on its top corners", () => {
    expect(titleR).not.toBeNull();
  });

  it("status bar declares a border-radius on its bottom corners", () => {
    expect(statusR).not.toBeNull();
  });

  it("#app-frame radius is consistent (no corner mismatch)", () => {
    expect(frameR).not.toBeNaN();
  });

  it("title-bar top-corner radius matches #app-frame radius", () => {
    expect(titleR).toBe(frameR);
  });

  it("status-bar bottom-corner radius matches #app-frame radius", () => {
    expect(statusR).toBe(frameR);
  });

  it("radius is large enough to be visibly rounded on macOS (≥12px)", () => {
    // macOS Sonoma/Sequoia windows use ~10-12px; Tahoe bumped to ~14px.
    expect(frameR!).toBeGreaterThanOrEqual(12);
  });
});

describe("window frame: body + html MUST NOT paint the corners", () => {
  // rulesFor("body") picks up both `body { ... }` and `html, body { ... }`
  // since both contain "body" in their comma-separated selector list.
  const bodyAll = rulesFor("body");
  const frameRules = rulesFor("#app-frame");

  it("body (and html) declare transparent background", () => {
    expect(bodyAll).toMatch(/background:\s*transparent/);
  });

  it("body does NOT set an opaque background like var(--bg) (it would fill the rounded corners of #app-frame)", () => {
    expect(bodyAll).not.toMatch(/background:\s*var\(--bg\)/);
  });

  it("#app-frame is the one with the opaque background (the visible window surface)", () => {
    expect(frameRules).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--bg\)/);
  });

  it("#app-frame has overflow: hidden (clips children to the radius)", () => {
    expect(frameRules).toMatch(/overflow:\s*hidden/);
  });
});

describe("window frame: DOM structure has the wrapper", () => {
  const html = readFileSync(resolve(__dirname, "index.html"), "utf-8");

  it("index.html wraps the chrome in #app-frame", () => {
    expect(html).toMatch(/<div\s+id="app-frame">/);
  });

  it("title-bar, tab-bar, terminal-area, and status-bar are INSIDE #app-frame", () => {
    // Use positional matching — the frame opens before the chrome and the
    // closing tag comes after the status bar.
    const m = html.match(/<div\s+id="app-frame">[\s\S]*?<div\s+id="status-bar"[^>]*><\/div>[\s\S]*?<\/div>/);
    expect(m, "#app-frame must contain #title-bar through #status-bar").not.toBeNull();
  });
});

describe("window frame: tauri window config", () => {
  const win = conf.app.windows[0];
  const app = conf.app as { windows: unknown[]; macOSPrivateApi?: boolean };

  it("decorations: false (no native chrome drawing a square frame)", () => {
    expect(win.decorations).toBe(false);
  });

  it("transparent: true (so the rounded body is the visible shape)", () => {
    expect(win.transparent).toBe(true);
  });

  it("shadow: true — native macOS NSWindow shadow follows the webview's alpha shape once the webview background is set to transparent", () => {
    expect(win.shadow).toBe(true);
  });

  // THE critical flag. Tauri silently IGNORES `transparent: true` on macOS
  // unless `macOSPrivateApi: true` is set on the app config. Without it, the
  // window is opaque and every rounded-corner effort is invisible. This is
  // what caused the "square corners" regression — the previous config had
  // `transparent: true` but not this flag.
  it("macOSPrivateApi: true at the app level — required for `transparent: true` to actually take effect on macOS", () => {
    expect(app.macOSPrivateApi).toBe(true);
  });
});

describe("window frame: webview must be transparent at the native layer", () => {
  const mainRs = readFileSync(resolve(__dirname, "../src-tauri/src/main.rs"), "utf-8");
  const cargoToml = readFileSync(resolve(__dirname, "../src-tauri/Cargo.toml"), "utf-8");

  it("Rust setup() forces the webview background color to transparent", () => {
    // Without this, WebKit paints an opaque default behind the HTML and
    // fills the rounded corners of the body with solid color — making the
    // window look square regardless of border-radius. See tauri-apps/wry#981.
    expect(mainRs).toMatch(/set_background_color\(\s*Some\(\s*tauri::webview::Color\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)\s*\)\s*\)/);
  });

  it("tauri Cargo feature `macos-private-api` is enabled — otherwise `transparent: true` is silently ignored on macOS", () => {
    // Tauri requires this cargo feature AND the config flag (`macOSPrivateApi: true`)
    // together. If either is missing, transparency doesn't work and the window
    // renders opaque — square corners. This is the exact bug that broke the
    // rounded-frame implementation end-to-end.
    expect(cargoToml).toMatch(/tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"macos-private-api"/);
  });
});

describe("window frame: #app-frame declares a rim border", () => {
  const frameRules = rulesFor("#app-frame");

  it("#app-frame declares a box-shadow (inner highlight + 1px outer rim)", () => {
    expect(frameRules).toMatch(/box-shadow:/);
  });
});
