import { describe, it, expect } from "vitest";
import {
  isWithinActivationGuard,
  isActivatingClick,
  __setLastFocusForTest,
  ACTIVATION_GUARD_MS,
} from "./window-activation";

describe("window activation guard", () => {
  it("is within the guard immediately after focus", () => {
    expect(isWithinActivationGuard(1000, 1000)).toBe(true);
    expect(isWithinActivationGuard(1000, 1000 + ACTIVATION_GUARD_MS - 1)).toBe(true);
  });

  it("is NOT within the guard once the window has elapsed", () => {
    expect(isWithinActivationGuard(1000, 1000 + ACTIVATION_GUARD_MS)).toBe(false);
    expect(isWithinActivationGuard(1000, 5000)).toBe(false);
  });

  it("defaults to not-activating before any focus is recorded", () => {
    __setLastFocusForTest(-Infinity);
    expect(isActivatingClick(0)).toBe(false);
  });

  it("isActivatingClick reflects the last recorded focus", () => {
    __setLastFocusForTest(1000);
    expect(isActivatingClick(1000)).toBe(true);
    expect(isActivatingClick(1000 + ACTIVATION_GUARD_MS + 1)).toBe(false);
  });
});
