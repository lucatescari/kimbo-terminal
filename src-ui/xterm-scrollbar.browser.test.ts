import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./style.css";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";

// xterm 6 replaced the native overflow scrollbar with a VS Code-derived DOM
// scrollable element. That silently broke two things at once, neither of
// which any existing test could see:
//
//   1. All our `::-webkit-scrollbar` rules targeted `.xterm-viewport`, which
//      no longer scrolls. They styled nothing, so the terminal rendered
//      xterm's stock 14px always-visible bar instead of the 6px auto-hiding
//      one the app is designed around.
//   2. terminal.ts drove the auto-hide off native "scroll" events on
//      `.xterm-viewport`. Those stopped firing entirely, so the `.scrolling`
//      class was never applied.
//
// Both failures were invisible to jsdom (no layout, no computed geometry) and
// to the type checker (no API changed). This test needs a real browser.

let frame: HTMLElement;
let host: HTMLElement;
let term: Terminal;

beforeEach(() => {
  // The scrollbar rules are scoped to #app-frame to out-specify the
  // stylesheet xterm generates at runtime, so the fixture must reproduce
  // that nesting or every assertion here passes for the wrong reason.
  frame = document.createElement("div");
  frame.id = "app-frame";
  host = document.createElement("div");
  host.className = "terminal-container";
  host.style.cssText = "width:600px;height:300px;position:relative;";
  frame.appendChild(host);
  document.body.appendChild(frame);

  term = new Terminal({ allowTransparency: true });
  term.open(host);
  // Enough rows to make the vertical axis scrollable, which is what makes
  // xterm tag the bar `.visible`.
  for (let i = 0; i < 300; i++) term.write(`line ${i}\r\n`);
});

afterEach(() => {
  term.dispose();
  frame.remove();
});

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `read()` satisfies `ok`, then return the value. Headless
 *  Chromium throttles CSS transitions unpredictably, so asserting an exact
 *  opacity after a fixed sleep is flaky. We care that the value SETTLES on
 *  the target, not how long the fade took. */
async function settlesOn(
  read: () => string,
  ok: (v: number) => boolean,
  what: string,
): Promise<number> {
  const deadline = Date.now() + 3000;
  let last = NaN;
  while (Date.now() < deadline) {
    last = parseFloat(read());
    if (ok(last)) return last;
    await settle(25);
  }
  throw new Error(`${what}: never settled (last value ${last})`);
}

describe("xterm 6 scrollbar", () => {
  it("auto-hides when idle and appears while scrolling", async () => {
    await settle(300);
    const bar = host.querySelector(".scrollbar.vertical") as HTMLElement;
    expect(bar, "xterm should render a vertical scrollbar").toBeTruthy();
    // xterm's own marker for "this axis can actually scroll". Our rules are
    // scoped to it so a non-scrollable axis is never forced visible.
    expect(bar.classList.contains("visible")).toBe(true);

    await settlesOn(
      () => getComputedStyle(bar).opacity,
      (v) => v === 0,
      "hidden at rest",
    );

    host.classList.add("scrolling");
    await settlesOn(
      () => getComputedStyle(bar).opacity,
      (v) => v === 1,
      "visible while scrolling",
    );

    host.classList.remove("scrolling");
    await settlesOn(
      () => getComputedStyle(bar).opacity,
      (v) => v === 0,
      "hidden again once idle",
    );
  });

  it("paints a 6px slider inside xterm's 14px hit target", async () => {
    await settle(300);
    const slider = host.querySelector(
      ".scrollbar.vertical > .slider",
    ) as HTMLElement;
    expect(slider).toBeTruthy();
    const cs = getComputedStyle(slider);

    // Geometry is inline-styled by xterm on every scroll, so we can't shrink
    // the element itself. We inset the painted area with transparent borders
    // and clip the background to the content box instead.
    expect(cs.boxSizing).toBe("border-box");
    expect(cs.backgroundClip).toBe("content-box");

    const painted =
      parseFloat(cs.width) -
      parseFloat(cs.borderLeftWidth) -
      parseFloat(cs.borderRightWidth);
    expect(painted, "painted core matches the pre-xterm-6 6px bar").toBe(6);
    expect(parseFloat(cs.width), "hit target stays xterm's full width").toBe(14);
  });

  it("leaves the slider colour to the theme so light themes stay legible", async () => {
    await settle(300);
    const slider = host.querySelector(
      ".scrollbar.vertical > .slider",
    ) as HTMLElement;
    const bg = getComputedStyle(slider).backgroundColor;
    // xterm derives this from the theme foreground at 20% opacity. If a
    // future change hardcodes a colour here, light themes get an invisible
    // slider — which is exactly what the old white-on-white rules did.
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).toMatch(/^rgba?\(/);
  });

  it("fires term.onScroll, the signal the auto-hide depends on", async () => {
    await settle(300);
    let fired = 0;
    const sub = term.onScroll(() => fired++);
    term.scrollToTop();
    await settle(80);
    term.scrollToBottom();
    await settle(80);
    sub.dispose();
    expect(fired, "onScroll must fire or the scrollbar never hides").toBeGreaterThan(0);
  });

  it("documents that .xterm-viewport no longer emits scroll events", async () => {
    await settle(300);
    // Pinned deliberately: if a future xterm restores native viewport
    // scrolling, this test fails and someone can simplify terminal.ts back
    // to a plain DOM listener rather than guessing.
    const viewport = host.querySelector(".xterm-viewport") as HTMLElement;
    expect(viewport).toBeTruthy();
    let fired = 0;
    viewport.addEventListener("scroll", () => fired++);
    term.scrollToTop();
    await settle(80);
    term.scrollToBottom();
    await settle(80);
    expect(fired).toBe(0);
  });
});
