// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRoot, getPrefs, resetCache, setPref } from "./ui-prefs";

describe("ui-prefs: --app-alpha", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCache();
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    localStorage.clear();
    resetCache();
    document.documentElement.removeAttribute("style");
  });

  it("writes --app-alpha = 1 for the default opacity (100)", () => {
    applyRoot();
    expect(getPrefs().backgroundOpacity).toBe(100);
    expect(document.documentElement.style.getPropertyValue("--app-alpha"))
      .toBe("1");
  });

  it("writes --app-alpha = 0.6 when backgroundOpacity is 60", () => {
    setPref("backgroundOpacity", 60);
    // setPref calls applyRoot() for us — no extra call needed.
    expect(document.documentElement.style.getPropertyValue("--app-alpha"))
      .toBe("0.6");
  });

  it("recomputes --app-alpha after setPref changes the value", () => {
    setPref("backgroundOpacity", 80);
    expect(document.documentElement.style.getPropertyValue("--app-alpha"))
      .toBe("0.8");
    setPref("backgroundOpacity", 100);
    expect(document.documentElement.style.getPropertyValue("--app-alpha"))
      .toBe("1");
  });
});

describe("ui-prefs: the accent belongs to the theme, not to a preference", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCache();
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    localStorage.clear();
    resetCache();
    document.documentElement.removeAttribute("style");
  });

  it("never writes an inline --accent, so a theme switch always wins", () => {
    // The old accent preference set --accent inline on :root, which beat the
    // stylesheet permanently: switching themes updated the theme's own accent
    // underneath while the chrome stayed pinned to the old colour.
    applyRoot();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.style.getPropertyValue("--accent-tint")).toBe("");
    expect(root.style.getPropertyValue("--accent-strong")).toBe("");
  });

  it("ignores an accent left behind in localStorage by an older build", () => {
    localStorage.setItem(
      "kimbo-ui-prefs-v1",
      JSON.stringify({ density: "comfortable", tabStyle: "underline", accent: "#ff00ff" }),
    );
    resetCache();
    applyRoot();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    expect((getPrefs() as unknown as Record<string, unknown>).accent).toBeUndefined();
  });
});
