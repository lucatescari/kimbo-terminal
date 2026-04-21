import { describe, it, expect, vi } from "vitest";

// settings.ts is the only module that contains `toggle()` and it depends on
// Tauri invoke / dialog plugin imports at the top. Mock them so importing
// the module doesn't blow up in jsdom.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), confirm: vi.fn(), ask: vi.fn() }));

import { __createToggleForTests as makeToggle } from "./settings";

describe("settings toggle: click flips the value and updates the .on class", () => {
  it("initial=false → first click fires onChange(true) and adds .on", () => {
    const calls: boolean[] = [];
    const t = makeToggle(false, (v) => calls.push(v));
    expect(t.classList.contains("on")).toBe(false);
    expect(t.getAttribute("aria-checked")).toBe("false");
    t.click();
    expect(calls).toEqual([true]);
    expect(t.classList.contains("on")).toBe(true);
    expect(t.getAttribute("aria-checked")).toBe("true");
  });

  it("initial=true → first click fires onChange(false) and drops .on", () => {
    const calls: boolean[] = [];
    const t = makeToggle(true, (v) => calls.push(v));
    expect(t.classList.contains("on")).toBe(true);
    t.click();
    expect(calls).toEqual([false]);
    expect(t.classList.contains("on")).toBe(false);
  });

  it("repeated clicks alternate — the closure no longer sticks to the initial value", () => {
    // Regression: we used to capture `value` at creation so every click
    // fired onChange with the same boolean and the CSS class never moved.
    const calls: boolean[] = [];
    const t = makeToggle(false, (v) => calls.push(v));
    t.click();
    t.click();
    t.click();
    t.click();
    expect(calls).toEqual([true, false, true, false]);
    // After four clicks we're back where we started.
    expect(t.classList.contains("on")).toBe(false);
  });

  it("disabled toggle swallows the click (no callback, no state change)", () => {
    const calls: boolean[] = [];
    const t = makeToggle(false, (v) => calls.push(v), true);
    expect(t.classList.contains("disabled")).toBe(true);
    t.click();
    t.click();
    expect(calls).toEqual([]);
    expect(t.classList.contains("on")).toBe(false);
  });

  it("role='switch' is set for accessibility", () => {
    const t = makeToggle(false, () => {});
    expect(t.getAttribute("role")).toBe("switch");
  });
});
