import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import "./style.css";

// The dot's colours come from tokens, and the whole point is that they follow
// the theme. Only a real engine resolves color-mix() and computed styles, so
// this cannot live in the jsdom suite.

const ACCENT = "rgb(217, 119, 87)"; // #d97757
const WARN = "rgb(249, 226, 175)"; // #f9e2af

let bar: HTMLElement;

function tab(activity?: string, opts: { active?: boolean } = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = opts.active ? "tab active" : "tab";
  if (activity) el.dataset.activity = activity;
  const dot = document.createElement("span");
  dot.className = "tab-activity";
  el.appendChild(dot);
  bar.appendChild(el);
  return el;
}

const dotOf = (el: HTMLElement) => el.querySelector<HTMLElement>(".tab-activity")!;

/** Alpha of a computed colour, whichever syntax the engine serialized it in.
 *  Chromium returns an oklab color-mix() as `color(srgb r g b / a)`, not
 *  `rgba(...)`, so matching on a colour syntax is not portable. A value with
 *  no alpha component is fully opaque. */
function alphaOf(color: string): number {
  const modern = color.match(/\/\s*([0-9.]+)\s*\)/);
  if (modern) return parseFloat(modern[1]);
  const legacy = color.match(/rgba\(\s*[^)]*,\s*([0-9.]+)\s*\)/);
  if (legacy) return parseFloat(legacy[1]);
  return 1;
}

beforeEach(() => {
  document.documentElement.style.setProperty("--active-border", "#d97757");
  document.documentElement.style.setProperty("--accent-yellow", "#f9e2af");
  bar = document.createElement("div");
  bar.id = "tab-bar";
  document.body.appendChild(bar);
});

afterEach(() => {
  document.documentElement.style.removeProperty("--active-border");
  document.documentElement.style.removeProperty("--accent-yellow");
  bar.remove();
});

describe("tab activity dot", () => {
  it("paints busy with the theme accent", () => {
    expect(getComputedStyle(dotOf(tab("busy"))).backgroundColor).toBe(ACCENT);
  });

  it("paints waiting with the warn colour", () => {
    expect(getComputedStyle(dotOf(tab("waiting"))).backgroundColor).toBe(WARN);
  });

  it("keeps busy and waiting visually distinct", () => {
    const busy = getComputedStyle(dotOf(tab("busy")));
    const waiting = getComputedStyle(dotOf(tab("waiting")));
    expect(busy.backgroundColor).not.toBe(waiting.backgroundColor);
    expect(busy.animationDuration).not.toBe(waiting.animationDuration);
  });

  it("hides the dot without removing it, so there is no layout shift", () => {
    const none = tab();
    const idle = tab("idle");
    expect(getComputedStyle(dotOf(none)).visibility).toBe("hidden");
    expect(getComputedStyle(dotOf(idle)).visibility).toBe("visible");
    // Same footprint either way.
    expect(dotOf(none).offsetWidth).toBe(dotOf(idle).offsetWidth);
  });

  it("animates busy and does not animate idle", () => {
    expect(getComputedStyle(dotOf(tab("busy"))).animationName).toBe("tab-activity-breathe");
    expect(getComputedStyle(dotOf(tab("idle"))).animationName).toBe("none");
  });

  it("moves the dot colour with the theme", () => {
    const el = tab("busy");
    document.documentElement.style.setProperty("--active-border", "#00ff41"); // Matrix
    expect(getComputedStyle(dotOf(el)).backgroundColor).toBe("rgb(0, 255, 65)");
  });

  it("tints the whole tab only for waiting", () => {
    const waiting = getComputedStyle(tab("waiting")).backgroundColor;
    const busy = getComputedStyle(tab("busy")).backgroundColor;
    expect(waiting).not.toBe(busy);
    // A translucent tint, not an opaque fill. Assert the alpha rather than a
    // colour syntax: Chromium serializes the oklab color-mix() as
    // `color(srgb r g b / a)` and would never match an rgba() pattern.
    const alpha = alphaOf(waiting);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  // Spec (2026-08-31-tab-activity-states-design.md, ~line 369) requires busy
  // and waiting to stay visually distinct "in all three tab styles". The
  // suite above only ever exercised the default/underline style (`bar` never
  // got a `data-style`) — pill and chevron were untested, and pill is
  // exactly where the hover/active specificity bug lived.
  for (const style of [undefined, "pill", "chevron"] as const) {
    const label = style ?? "default";

    it(`keeps busy and waiting visually distinct in the ${label} tab style`, () => {
      if (style) bar.dataset.style = style;
      const waiting = getComputedStyle(tab("waiting")).backgroundColor;
      const busy = getComputedStyle(tab("busy")).backgroundColor;
      expect(waiting).not.toBe(busy);
      const alpha = alphaOf(waiting);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    });
  }

  it("keeps the waiting tint on an active tab in pill style, where .tab.active would otherwise win the tie", () => {
    // `#tab-bar[data-style="pill"] .tab.active` and the waiting-tint rule are
    // both (1,3,0) specificity — an exact tie broken by source order, not by
    // selector shape. This is the case I1 named explicitly: a pill-style
    // active tab never showed the tint before the fix moved the waiting rule
    // after the Pill/Chevron overrides in style.css.
    bar.dataset.style = "pill";
    const activeOpaque = getComputedStyle(tab(undefined, { active: true })).backgroundColor;
    const activeWaiting = getComputedStyle(tab("waiting", { active: true })).backgroundColor;

    expect(activeWaiting).not.toBe(activeOpaque);
    const alpha = alphaOf(activeWaiting);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it("keeps the waiting tint under a real pointer hover", async () => {
    // `.tab:hover:not(.active)` is (0,3,0) — the plain waiting selector
    // (`#tab-bar .tab[data-activity="waiting"]`) is (1,2,0), which already
    // outranks it on the ID alone regardless of source order, so this drives
    // an actual pointer hover (real Chromium, via Playwright, not jsdom)
    // rather than only asserting on specificity numbers by hand.
    const el = tab("waiting");
    const before = getComputedStyle(el).backgroundColor;
    const alphaBefore = alphaOf(before);
    expect(alphaBefore).toBeGreaterThan(0);
    expect(alphaBefore).toBeLessThan(1);

    await userEvent.hover(el);
    const after = getComputedStyle(el).backgroundColor;

    expect(after).toBe(before);
    const alphaAfter = alphaOf(after);
    expect(alphaAfter).toBeGreaterThan(0);
    expect(alphaAfter).toBeLessThan(1);
  });
});
