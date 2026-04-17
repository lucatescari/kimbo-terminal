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
    expect(css).toContain("rgba(255, 255, 255, 0.12)");
  });

  it("scrollbar is hidden by default (only shows on pane hover)", () => {
    // The default thumb should be fully transparent
    expect(css).toContain("rgba(255, 255, 255, 0.0)");
    // Visible only on .pane:hover
    expect(css).toContain(".pane:hover .xterm .xterm-viewport::-webkit-scrollbar-thumb");
  });
});
