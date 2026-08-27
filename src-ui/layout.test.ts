import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Test the HTML structure and CSS to catch layout regressions against the
// Kimbo Redesign handoff (custom title bar, new tab styles, status bar).

const html = readFileSync(resolve(__dirname, "index.html"), "utf-8");
const css = readFileSync(resolve(__dirname, "style.css"), "utf-8");

describe("index.html structure", () => {
  it("has a custom title-bar for the new chrome", () => {
    expect(html).toContain('id="title-bar"');
  });

  it("has tab-bar element", () => {
    expect(html).toContain('id="tab-bar"');
  });

  it("has terminal-area element", () => {
    expect(html).toContain('id="terminal-area"');
  });

  it("has status-bar element", () => {
    expect(html).toContain('id="status-bar"');
  });

  it("has overlay element with hidden class", () => {
    expect(html).toContain('id="overlay"');
    expect(html).toContain('class="hidden"');
  });

  it("loads main.ts as module", () => {
    expect(html).toContain('type="module"');
    expect(html).toContain('src="main.ts"');
  });
});

describe("style.css", () => {
  it("has pane active border style", () => {
    expect(css).toContain(".pane.active");
    expect(css).toContain("var(--active-border)");
  });

  // The terminal scrollbar moved off ::-webkit-scrollbar in xterm 6, which
  // swapped the native overflow scrollbar for a DOM one. These checks only
  // pin that our rules aim at the element that actually exists now — the
  // behaviour they used to approximate (auto-hide, 6px painted width,
  // theme-driven colour) is covered for real, with layout and computed
  // styles, in xterm-scrollbar.browser.test.ts.
  it("targets the xterm 6 scrollable element, not the dead viewport scrollbar", () => {
    expect(css).toContain(".xterm-scrollable-element > .scrollbar");
    expect(css).toContain(".xterm-scrollable-element > .scrollbar > .slider");
    // `.xterm-viewport` still exists and still needs its opaque background
    // neutralised for --app-alpha, but it no longer scrolls, so nothing may
    // hang scrollbar styling off it.
    expect(css).toContain(".xterm .xterm-viewport");
    expect(css).not.toMatch(/xterm-viewport::-webkit-scrollbar/);
  });

  it("keeps the terminal scrollbar auto-hiding via the .scrolling class", () => {
    expect(css).toMatch(
      /\.terminal-container\.scrolling[\s\S]{0,200}?\.scrollbar\.visible/,
    );
    expect(css).toMatch(/\.scrollbar\.visible\s*\{[^}]*opacity:\s*0/);
  });

  it("leaves the terminal slider colour to the xterm theme", () => {
    // Hardcoding a colour here is how the old rules broke light themes: a
    // white thumb on a white background is invisible. xterm derives the
    // slider from the theme foreground, so our rule must set geometry only.
    const sliderRule = /\.xterm-scrollable-element > \.slider[^{]*\{([^}]*)\}/.exec(css)
      ?? /\.scrollbar > \.slider\s*\{([^}]*)\}/.exec(css);
    expect(sliderRule, "slider rule should exist").toBeTruthy();
    expect(sliderRule![1]).not.toMatch(/background(-color)?\s*:\s*(#|rgb|hsl|white|black)/);
  });

  it("defines the full design-token set", () => {
    for (const token of [
      "--bg-elevated",
      "--bg-sidebar",
      "--border-strong",
      "--fg-strong",
      "--fg-muted",
      "--fg-dim",
      "--accent-tint",
      "--shadow-lg",
      "--font-mono",
      "--font-ui",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("supports three tab styles via [data-style]", () => {
    // Default (underline) uses the base .tab.active::after rule; pill and
    // chevron layer on via attribute selectors.
    expect(css).toContain('#tab-bar[data-style="pill"]');
    expect(css).toContain('#tab-bar[data-style="chevron"]');
    expect(css).toMatch(/\.tab\.active::after\s*\{/);
  });

  it("density is driven by [data-density] on :root", () => {
    expect(css).toContain(':root[data-density="compact"]');
    expect(css).toContain(':root[data-density="comfortable"]');
    expect(css).toContain(':root[data-density="roomy"]');
  });
});

describe("title bar", () => {
  // `#title-bar` has multiple rule blocks (base + corner-radius rounding).
  // Concatenate them so the assertions match regardless of which block a
  // property is declared in.
  const titleBarRules = [...css.matchAll(/#title-bar\s*\{([^}]*)\}/g)]
    .map((m) => m[1])
    .join("\n");
  it("title bar has a fixed height", () => {
    expect(titleBarRules).toMatch(/height:\s*36px/);
  });
  it("uses --bg-titlebar via color-mix alpha-aware background", () => {
    expect(titleBarRules).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--bg-titlebar\)/);
  });
});

describe("tab bar (handoff design)", () => {
  const activeRule = css.match(/\.tab\.active\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabRule = css.match(/\.tab\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabBarRule = css.match(/#tab-bar\s*\{([^}]*)\}/)?.[1] ?? "";

  it("active tab background matches terminal area (--bg) via color-mix", () => {
    expect(activeRule).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--bg\)/);
  });

  it("tab bar uses monospace font", () => {
    expect(tabRule).toMatch(/font-family:\s*var\(--font-mono\)/);
  });

  it("tab bar uses stretch alignment (full-height tabs)", () => {
    expect(tabBarRule).toMatch(/align-items:\s*stretch/);
  });

  it("inactive tabs have a hover state distinct from the active rule", () => {
    expect(css).toMatch(/\.tab:hover:not\(\.active\)/);
  });

  it("active tab has an underline indicator", () => {
    expect(css).toMatch(/\.tab\.active::after\s*\{/);
  });

  it("pill style swaps the underline for a bordered pill", () => {
    expect(css).toMatch(/#tab-bar\[data-style="pill"\]\s+\.tab\.active/);
  });

  it("chevron style applies a clip-path", () => {
    expect(css).toMatch(/#tab-bar\[data-style="chevron"\]\s+\.tab/);
    expect(css).toMatch(/clip-path:\s*polygon/);
  });
});
