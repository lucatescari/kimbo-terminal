import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./style.css";

// The dot's colours come from tokens, and the whole point is that they follow
// the theme. Only a real engine resolves color-mix() and computed styles, so
// this cannot live in the jsdom suite.

const ACCENT = "rgb(217, 119, 87)"; // #d97757
const WARN = "rgb(249, 226, 175)"; // #f9e2af

let bar: HTMLElement;

function tab(activity?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "tab";
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
});
