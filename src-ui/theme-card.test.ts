// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderUnifiedThemeCard } from "./theme-card";
import type { UnifiedTheme } from "./settings-types";

function makeTheme(overrides: Partial<UnifiedTheme> = {}): UnifiedTheme {
  return {
    slug: "sample",
    name: "Sample",
    theme_type: "dark",
    author: "someone",
    version: "1.2.3",
    swatches: {
      background: "#111",
      foreground: "#eee",
      accent: "#09f",
      cursor: "#fff",
    },
    source: "Installed",
    active: false,
    ...overrides,
  };
}

describe("renderUnifiedThemeCard", () => {
  it("shows the theme name", () => {
    const card = renderUnifiedThemeCard(makeTheme(), noopCallbacks());
    expect(card.textContent).toContain("Sample");
  });

  it("renders @author as a link to the author's GitHub", () => {
    const card = renderUnifiedThemeCard(makeTheme({ author: "jsmith" }), noopCallbacks());
    const link = card.querySelector('[data-role="author-link"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("@jsmith");
    expect(link.getAttribute("href")).toBe("https://github.com/jsmith");
  });

  it("omits the author segment when author is empty", () => {
    const card = renderUnifiedThemeCard(makeTheme({ author: "" }), noopCallbacks());
    expect(card.querySelector('[data-role="author-link"]')).toBeNull();
    expect(card.textContent).toContain("v1.2.3");
  });

  it("omits the version segment when version is empty", () => {
    const card = renderUnifiedThemeCard(makeTheme({ version: "" }), noopCallbacks());
    expect(card.textContent).not.toMatch(/v\d/);
  });

  it("activates the theme on left click for Installed / Builtin", () => {
    const onActivate = vi.fn();
    const cb = { ...noopCallbacks(), onActivate };
    const card = renderUnifiedThemeCard(makeTheme({ source: "Installed" }), cb);
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onActivate).toHaveBeenCalledWith("sample");
  });

  it("installs the theme on left click for Available", () => {
    const onInstall = vi.fn();
    const cb = { ...noopCallbacks(), onInstall };
    const card = renderUnifiedThemeCard(makeTheme({ source: "Available" }), cb);
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onInstall).toHaveBeenCalledWith("sample");
  });

  it("fires onContextMenu on right click and prevents the default menu", () => {
    const onContextMenu = vi.fn();
    const cb = { ...noopCallbacks(), onContextMenu };
    const card = renderUnifiedThemeCard(makeTheme(), cb);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    card.dispatchEvent(ev);
    expect(onContextMenu).toHaveBeenCalledWith("sample", 10, 20);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("does not activate when the author link is clicked", () => {
    const onActivate = vi.fn();
    const onOpenAuthor = vi.fn();
    const cb = { ...noopCallbacks(), onActivate, onOpenAuthor };
    const card = renderUnifiedThemeCard(makeTheme({ author: "jsmith" }), cb);
    const link = card.querySelector('[data-role="author-link"]') as HTMLElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpenAuthor).toHaveBeenCalledWith("jsmith");
    expect(onActivate).not.toHaveBeenCalled();
  });
});

function noopCallbacks() {
  return {
    onActivate: vi.fn(),
    onInstall: vi.fn(),
    onOpenAuthor: vi.fn(),
    onContextMenu: vi.fn(),
  };
}
