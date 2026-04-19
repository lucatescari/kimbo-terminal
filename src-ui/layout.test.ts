import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Test the HTML structure and CSS to catch layout regressions.

const html = readFileSync(resolve(__dirname, "index.html"), "utf-8");
const css = readFileSync(resolve(__dirname, "style.css"), "utf-8");

describe("index.html structure", () => {
  it("does NOT have a custom title-bar (native macOS title bar handles it)", () => {
    expect(html).not.toContain('id="title-bar"');
    expect(html).not.toContain("data-tauri-drag-region");
  });

  it("has exactly one Kimbo text (in <title> only)", () => {
    // The <title> tag is the only place "Kimbo" should appear in the HTML.
    // The macOS title bar reads this, so the app title renders natively.
    const matches = html.match(/Kimbo/g) || [];
    expect(matches.length).toBe(1);
  });

  it("has tab-bar element", () => {
    expect(html).toContain('id="tab-bar"');
  });

  it("has terminal-area element", () => {
    expect(html).toContain('id="terminal-area"');
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
  it("does NOT have #titlebar styles", () => {
    expect(css).not.toContain("#titlebar");
  });

  it("has pane active border style", () => {
    expect(css).toContain(".pane.active");
    expect(css).toContain("var(--active-border)");
  });

  it("has xterm scrollbar overrides", () => {
    expect(css).toContain(".xterm .xterm-viewport");
    expect(css).toContain("webkit-scrollbar");
  });

  it("scrollbar thumb is translucent, not white", () => {
    // Should use rgba with low alpha, never solid white
    expect(css).not.toMatch(/scrollbar-thumb\s*\{[^}]*background:\s*#fff/);
    expect(css).not.toMatch(/scrollbar-thumb\s*\{[^}]*background:\s*white/);
    expect(css).toContain("rgba(255, 255, 255, 0.25)");
  });

  it("scrollbar is hidden by default and auto-shows while actively scrolling", () => {
    // Default thumb is fully transparent
    expect(css).toContain("rgba(255, 255, 255, 0)");
    // A .scrolling class on the terminal-container fades the thumb in
    expect(css).toContain(".terminal-container.scrolling .xterm .xterm-viewport::-webkit-scrollbar-thumb");
  });
});

describe("tab bar styling (modern chrome-seamless)", () => {
  const activeRule =
    css.match(/\.tab\.active\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabRule =
    css.match(/\.tab\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabBarRule =
    css.match(/#tab-bar\s*\{([^}]*)\}/)?.[1] ?? "";

  it("active tab has NO border-bottom (no underline indicator)", () => {
    expect(activeRule).not.toMatch(/border-bottom/);
  });

  it("tab bar has NO border-bottom (seamless into terminal area)", () => {
    expect(tabBarRule).not.toMatch(/border-bottom/);
  });

  it("inactive tab has top-only rounded corners (8px 8px 0 0)", () => {
    expect(tabRule).toMatch(/border-radius:\s*8px\s+8px\s+0\s+0/);
  });

  it("active tab background uses --bg (matches terminal area)", () => {
    expect(activeRule).toMatch(/background:\s*var\(--bg\)/);
  });

  it("active tab is nudged 1px forward to overlap the seam", () => {
    expect(activeRule).toMatch(/position:\s*relative/);
    expect(activeRule).toMatch(/top:\s*1px/);
  });

  it("tab bar uses a 2px gap between tabs", () => {
    expect(tabBarRule).toMatch(/gap:\s*2px/);
  });

  it("tab bar anchors tabs to the bottom edge (align-items: flex-end)", () => {
    expect(tabBarRule).toMatch(/align-items:\s*flex-end/);
  });

  it("inactive tabs have a hover state distinct from the active rule", () => {
    expect(css).toMatch(/\.tab:hover:not\(\.active\)/);
  });

  it("no border-right separator between tabs", () => {
    expect(tabRule).not.toMatch(/border-right/);
  });
});
