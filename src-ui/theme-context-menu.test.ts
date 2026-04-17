// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { showThemeContextMenu } from "./theme-context-menu";
import type { UnifiedTheme } from "./settings-types";

function makeTheme(overrides: Partial<UnifiedTheme> = {}): UnifiedTheme {
  return {
    slug: "sample",
    name: "Sample",
    theme_type: "dark",
    author: "someone",
    version: "1.0.0",
    swatches: { background: "#111", foreground: "#eee", accent: "#09f", cursor: "#fff" },
    source: "Installed",
    active: false,
    ...overrides,
  };
}

function noopHandlers() {
  return {
    onActivate: vi.fn(),
    onInstall: vi.fn(),
    onDelete: vi.fn(),
    onOpenAuthor: vi.fn(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showThemeContextMenu", () => {
  it("shows Activate and Delete for an Installed theme", () => {
    showThemeContextMenu(makeTheme({ source: "Installed" }), 0, 0, noopHandlers());
    const menu = document.querySelector('[data-role="theme-ctx-menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("Activate");
    expect(menu.textContent).toContain("Delete");
    expect(menu.textContent).not.toContain("Install");
  });

  it("shows Activate only (no Delete) for a Builtin theme", () => {
    showThemeContextMenu(makeTheme({ source: "Builtin" }), 0, 0, noopHandlers());
    const menu = document.querySelector('[data-role="theme-ctx-menu"]') as HTMLElement;
    expect(menu.textContent).toContain("Activate");
    expect(menu.textContent).not.toContain("Delete");
  });

  it("shows Install (no Activate, no Delete) for an Available theme", () => {
    showThemeContextMenu(makeTheme({ source: "Available" }), 0, 0, noopHandlers());
    const menu = document.querySelector('[data-role="theme-ctx-menu"]') as HTMLElement;
    expect(menu.textContent).toContain("Install");
    expect(menu.textContent).not.toContain("Activate");
    expect(menu.textContent).not.toContain("Delete");
  });

  it("disables Activate when the theme is already active", () => {
    showThemeContextMenu(makeTheme({ source: "Installed", active: true }), 0, 0, noopHandlers());
    const item = findMenuItem("Activate");
    expect(item.getAttribute("data-disabled")).toBe("true");
  });

  it("disables Delete when the theme is active with a tooltip hint", () => {
    showThemeContextMenu(makeTheme({ source: "Installed", active: true }), 0, 0, noopHandlers());
    const item = findMenuItem("Delete");
    expect(item.getAttribute("data-disabled")).toBe("true");
    expect(item.getAttribute("title")).toMatch(/switch/i);
  });

  it("hides View author when author is empty", () => {
    showThemeContextMenu(makeTheme({ author: "" }), 0, 0, noopHandlers());
    const menu = document.querySelector('[data-role="theme-ctx-menu"]') as HTMLElement;
    expect(menu.textContent).not.toContain("View author");
  });

  it("invokes onActivate when Activate is clicked (and dismisses menu)", () => {
    const handlers = noopHandlers();
    showThemeContextMenu(makeTheme({ source: "Installed" }), 0, 0, handlers);
    findMenuItem("Activate").click();
    expect(handlers.onActivate).toHaveBeenCalled();
    expect(document.querySelector('[data-role="theme-ctx-menu"]')).toBeNull();
  });

  it("invokes onDelete when Delete is clicked on a non-active installed theme", () => {
    const handlers = noopHandlers();
    showThemeContextMenu(makeTheme({ source: "Installed", active: false }), 0, 0, handlers);
    findMenuItem("Delete").click();
    expect(handlers.onDelete).toHaveBeenCalled();
  });

  it("dismisses on outside click", () => {
    showThemeContextMenu(makeTheme(), 0, 0, noopHandlers());
    expect(document.querySelector('[data-role="theme-ctx-menu"]')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector('[data-role="theme-ctx-menu"]')).toBeNull();
  });

  it("dismisses on Escape", () => {
    showThemeContextMenu(makeTheme(), 0, 0, noopHandlers());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[data-role="theme-ctx-menu"]')).toBeNull();
  });
});

function findMenuItem(label: string): HTMLElement {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[data-role="theme-ctx-menu"] [data-role="menu-item"]'),
  );
  const hit = items.find((el) => el.textContent?.includes(label));
  if (!hit) throw new Error(`menu item containing "${label}" not found`);
  return hit;
}
