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

  it("has xterm scrollbar overrides", () => {
    expect(css).toContain(".xterm .xterm-viewport");
    expect(css).toContain("webkit-scrollbar");
  });

  it("scrollbar thumb is translucent, not solid white", () => {
    expect(css).not.toMatch(/scrollbar-thumb\s*\{[^}]*background:\s*#fff/);
    expect(css).not.toMatch(/scrollbar-thumb\s*\{[^}]*background:\s*white/);
    expect(css).toContain("rgba(255, 255, 255, 0.25)");
  });

  it("scrollbar is hidden by default and auto-shows while actively scrolling", () => {
    expect(css).toContain("rgba(255, 255, 255, 0)");
    expect(css).toContain(".terminal-container.scrolling .xterm .xterm-viewport::-webkit-scrollbar-thumb");
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
  const titleBarRule = css.match(/#title-bar\s*\{([^}]*)\}/)?.[1] ?? "";
  it("title bar has a fixed height", () => {
    expect(titleBarRule).toMatch(/height:\s*36px/);
  });
  it("uses --bg-titlebar", () => {
    expect(titleBarRule).toMatch(/background:\s*var\(--bg-titlebar\)/);
  });
});

describe("tab bar (handoff design)", () => {
  const activeRule = css.match(/\.tab\.active\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabRule = css.match(/\.tab\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabBarRule = css.match(/#tab-bar\s*\{([^}]*)\}/)?.[1] ?? "";

  it("active tab background matches terminal area (--bg)", () => {
    expect(activeRule).toMatch(/background:\s*var\(--bg\)/);
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
