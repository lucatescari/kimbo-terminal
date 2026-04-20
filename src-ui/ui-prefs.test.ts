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
