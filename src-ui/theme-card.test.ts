// @vitest-environment jsdom
//
// Tests the theme card behavior in isolation:
//   - Click on Available card → onInstall callback (gallery → install flow)
//   - Click on Builtin/Installed card → onActivate callback
//   - Two-step uninstall: 1st click on × shows "Delete?" pill (no callback),
//     2nd click within UNINSTALL_ARM_MS fires onUninstall
//   - Arming times out after UNINSTALL_ARM_MS — a delayed second click does NOT
//     fire the uninstall, it just re-arms
//   - Author link click triggers onAuthorClick (not onActivate)
//   - Builtin / Available cards have NO uninstall × (only Installed do)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildThemeCard, UNINSTALL_ARM_MS, type ThemeCardCallbacks } from "./theme-card";
import type { UnifiedTheme } from "./settings-types";

function makeTheme(overrides: Partial<UnifiedTheme> = {}): UnifiedTheme {
  return {
    slug: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    theme_type: "dark",
    author: "catppuccin",
    version: "1.0.0",
    swatches: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      accent: "#cba6f7",
      cursor: "#f5e0dc",
    },
    source: "Installed",
    active: false,
    ...overrides,
  };
}

interface Calls {
  activate: string[];
  install: string[];
  uninstall: string[];
  author: string[];
}

function makeCallbacks(): ThemeCardCallbacks & { calls: Calls } {
  const calls: Calls = { activate: [], install: [], uninstall: [], author: [] };
  return {
    onActivate: (s) => calls.activate.push(s),
    onInstall: (s) => calls.install.push(s),
    onUninstall: (s) => calls.uninstall.push(s),
    onAuthorClick: (s) => calls.author.push(s),
    calls,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("theme card: rendering", () => {
  it("renders name + author + version", () => {
    const card = buildThemeCard(makeTheme(), { active: false }, makeCallbacks());
    expect(card.querySelector(".name span")?.textContent).toBe("Catppuccin Mocha");
    expect(card.querySelector(".author a")?.textContent).toBe("@catppuccin");
    expect(card.querySelector(".author span")?.textContent).toBe(" · v1.0.0");
  });

  it("shows the active dot when opts.active is true", () => {
    const off = buildThemeCard(makeTheme(), { active: false }, makeCallbacks());
    const on = buildThemeCard(makeTheme(), { active: true }, makeCallbacks());
    expect(off.querySelector(".name .dot")).toBeNull();
    expect(on.querySelector(".name .dot")).not.toBeNull();
    expect(on.classList.contains("selected")).toBe(true);
  });

  it("shows an Install badge for Available themes only", () => {
    const avail = buildThemeCard(makeTheme({ source: "Available" }), { active: false }, makeCallbacks());
    const inst = buildThemeCard(makeTheme({ source: "Installed" }), { active: false }, makeCallbacks());
    const builtin = buildThemeCard(makeTheme({ source: "Builtin" }), { active: false }, makeCallbacks());
    expect(avail.querySelector(".badge")?.textContent).toBe("Install");
    expect(inst.querySelector(".badge")).toBeNull();
    expect(builtin.querySelector(".badge")).toBeNull();
  });

  it("shows the uninstall × ONLY for Installed themes (not Builtin or Available)", () => {
    const inst = buildThemeCard(makeTheme({ source: "Installed" }), { active: false }, makeCallbacks());
    const builtin = buildThemeCard(makeTheme({ source: "Builtin", slug: "kimbo-dark" }), { active: false }, makeCallbacks());
    const avail = buildThemeCard(makeTheme({ source: "Available" }), { active: false }, makeCallbacks());
    expect(inst.querySelector(".theme-del")).not.toBeNull();
    expect(builtin.querySelector(".theme-del")).toBeNull();
    expect(avail.querySelector(".theme-del")).toBeNull();
  });
});

describe("theme card: click → activate / install", () => {
  it("clicking an Installed card calls onActivate (not onInstall, not onUninstall)", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Installed", slug: "tokyo-night" }), { active: false }, cb);
    card.click();
    expect(cb.calls.activate).toEqual(["tokyo-night"]);
    expect(cb.calls.install).toEqual([]);
    expect(cb.calls.uninstall).toEqual([]);
  });

  it("clicking a Builtin card calls onActivate", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Builtin", slug: "kimbo-dark" }), { active: false }, cb);
    card.click();
    expect(cb.calls.activate).toEqual(["kimbo-dark"]);
  });

  it("clicking an Available card calls onInstall (the gallery flow)", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Available", slug: "rose-pine" }), { active: false }, cb);
    card.click();
    expect(cb.calls.install).toEqual(["rose-pine"]);
    expect(cb.calls.activate).toEqual([]);
  });

  it("clicking the author link does NOT activate the theme", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Installed", author: "lucatescari" }), { active: false }, cb);
    const link = card.querySelector<HTMLAnchorElement>(".author a")!;
    link.click();
    expect(cb.calls.author).toEqual(["lucatescari"]);
    expect(cb.calls.activate).toEqual([]);
  });
});

describe("theme card: two-step uninstall flow", () => {
  it("first click on × does NOT call onUninstall — it arms the pill", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Installed" }), { active: false }, cb);
    document.body.appendChild(card);

    const del = card.querySelector<HTMLElement>(".theme-del")!;
    expect(del.classList.contains("arm")).toBe(false);

    del.click();

    expect(cb.calls.uninstall).toEqual([]);                        // NOT called yet
    expect(del.classList.contains("arm")).toBe(true);              // armed visually
    expect(del.querySelector("span")?.textContent).toBe("Delete?"); // pill text
  });

  it("second click on the armed × calls onUninstall with the slug", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Installed", slug: "catppuccin-mocha" }), { active: false }, cb);
    document.body.appendChild(card);

    const del = card.querySelector<HTMLElement>(".theme-del")!;
    del.click(); // arm
    del.click(); // confirm

    expect(cb.calls.uninstall).toEqual(["catppuccin-mocha"]);
    expect(del.classList.contains("arm")).toBe(false);
  });

  it("clicking the × does NOT bubble to the card click handler (no spurious activate)", () => {
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Installed", slug: "tokyo-night" }), { active: false }, cb);
    document.body.appendChild(card);

    const del = card.querySelector<HTMLElement>(".theme-del")!;
    del.click(); // arm
    del.click(); // confirm

    expect(cb.calls.activate).toEqual([]); // card click never fired
    expect(cb.calls.uninstall).toEqual(["tokyo-night"]);
  });

  it("the armed pill auto-disarms after UNINSTALL_ARM_MS — a late second click only re-arms", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const card = buildThemeCard(makeTheme({ source: "Installed", slug: "rose-pine" }), { active: false }, cb);
    document.body.appendChild(card);

    const del = card.querySelector<HTMLElement>(".theme-del")!;
    del.click(); // arm
    expect(del.classList.contains("arm")).toBe(true);

    vi.advanceTimersByTime(UNINSTALL_ARM_MS + 50);
    expect(del.classList.contains("arm")).toBe(false); // disarmed by timer

    del.click(); // re-arm (NOT confirm — armed state was reset)
    expect(cb.calls.uninstall).toEqual([]);
    expect(del.classList.contains("arm")).toBe(true);

    vi.useRealTimers();
  });
});
