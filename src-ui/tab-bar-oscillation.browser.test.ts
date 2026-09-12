import { describe, it, expect, vi, beforeEach } from "vitest";
import "./style.css";

// Regression for the tab-bar "spazzing" / flashing bug: with many tabs, sitting
// on a far-right tab made the strip slide continuously and flash. Three coupled
// defects (all asserted below to stay fixed):
//
//  1. Scroll arrows were `flex-shrink:0` siblings of the `flex:1` scroll region,
//     so toggling their visibility changed the region's clientWidth — the very
//     value used to decide arrow visibility. No stable fixed point at the edges.
//     FIX: arrows are absolute overlays; clientWidth is constant.
//  2. renderTabBar() unconditionally fired scrollActiveTabIntoView({smooth}) on
//     EVERY render (badges, OSC titles, the 2s CWD poll), restarting a scroll
//     animation each time. FIX: only scroll when the active tab is actually out
//     of view, instantly.
//  3. renderTabBar() did `innerHTML = ""` and rebuilt all tab DOM every render
//     => flash. FIX: reconcile by tab id, reusing elements.

vi.mock("./pty", () => ({ getCwd: vi.fn().mockResolvedValue(null) }));
vi.mock("./window-activation", () => ({ isActivatingClick: () => false }));
vi.mock("./panes", () => ({
  initPanes: vi.fn(),
  createRootPane: vi.fn().mockResolvedValue({}),
  splitActive: vi.fn(),
  closeActive: vi.fn(),
  focusDirection: vi.fn(),
  getActiveSession: vi.fn().mockReturnValue(undefined),
  fitAllPanes: vi.fn(),
  getTree: vi.fn().mockReturnValue(null),
  setTree: vi.fn(),
  disposeTree: vi.fn(),
  getActivePaneId: vi.fn().mockReturnValue(-1),
  splitLeaf: vi.fn(),
}));
vi.mock("./kimbo-bus", () => ({ kimboBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock("./title-bar", () => ({ renderTitle: vi.fn() }));
vi.mock("./tab-drag", () => ({
  initTabDrag: vi.fn(),
  cancelDrag: vi.fn(),
  wasJustDragging: () => false,
}));
vi.mock("./theme-context-menu", () => ({ showContextMenu: vi.fn() }));
vi.mock("./icons", () => ({
  icon: () => document.createElementNS("http://www.w3.org/2000/svg", "svg"),
}));
vi.mock("./closed-tabs", () => ({
  pushClosedTab: vi.fn(),
  popClosedTab: vi.fn(),
  shapeFromTreeAsync: vi.fn(),
  firstLeafCwd: vi.fn(),
  firstLeafScrollback: vi.fn(),
  firstLeafClaudeResume: vi.fn(),
}));

import { initTabs, createTab, switchTab, setTabBadge } from "./tabs";

const NEXT_FRAME = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function buildOverflowingBar(tabCount: number) {
  const tabBar = document.createElement("div");
  tabBar.id = "tab-bar";
  tabBar.style.width = "420px";
  const area = document.createElement("div");
  document.body.append(tabBar, area);

  initTabs(tabBar, area);
  for (let i = 0; i < tabCount; i++) await createTab(`/Users/x/project-number-${i}`);
  await settleWidths(tabBar);
  return { tabBar };
}

const region = (bar: HTMLElement) => bar.querySelector<HTMLElement>(".tab-scroll-region")!;

/** The first family in `--font-mono`, which is what `.tab` renders in. Its
 *  metrics decide every tab's width, and therefore the strip's scrollWidth. */
const TAB_FONT = '500 12px "JetBrains Mono"';

/** Make the strip's width final before anything measures it.
 *
 *  Two separate traps make the obvious `await document.fonts.ready` useless
 *  here, both confirmed by instrumenting this file:
 *
 *  1. The stylesheet declaring Inter and JetBrains Mono loads asynchronously,
 *     after style.css. Until it lands, `document.fonts` holds only the Nerd
 *     Font face and reports `status === "loaded"`, because nothing has been
 *     requested yet. Awaiting readiness at that moment returns immediately and
 *     guarantees nothing.
 *  2. Whether that stylesheet lands before or during the test varied run to
 *     run. When it landed mid-test the tabs re-laid out one frame later, the
 *     strip lost width under an already-captured baseline, and
 *     scrollActiveTabIntoView correctly followed the shrinking content. The
 *     test read that as drift and failed about one run in five.
 *
 *  So: ask for the font explicitly, and keep asking until a face by that name
 *  actually reports loaded, which also waits out trap 1 since `load()` matches
 *  nothing until the @font-face rule has been parsed. Then hold until the
 *  measured width stops moving. The assertions themselves are unchanged. */
async function settleWidths(bar: HTMLElement): Promise<void> {
  const strip = region(bar);
  const deadline = performance.now() + 5_000;

  const fontIsLoaded = () =>
    [...document.fonts].some((f) => f.family === "JetBrains Mono" && f.status === "loaded");

  while (performance.now() < deadline && !fontIsLoaded()) {
    await document.fonts.load(TAB_FONT, "0123456789abcdefghijklmnopqrstuvwxyz-");
    await NEXT_FRAME();
  }

  let lastWidth = -1;
  let stableFrames = 0;
  while (performance.now() < deadline) {
    await NEXT_FRAME();
    const width = strip.scrollWidth;
    stableFrames = width === lastWidth ? stableFrames + 1 : 0;
    lastWidth = width;
    if (stableFrames >= 3) return;
  }
  throw new Error(
    `tab strip width never settled (last ${lastWidth}px, font loaded=${fontIsLoaded()})`,
  );
}

describe("tab bar far-right oscillation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("scroll-region clientWidth is constant regardless of scroll position (arrows don't steal width)", async () => {
    const { tabBar } = await buildOverflowingBar(25);
    const r = region(tabBar);
    expect(r.scrollWidth).toBeGreaterThan(r.clientWidth);

    const at = async (scrollLeft: number) => {
      r.scrollLeft = scrollLeft;
      r.dispatchEvent(new Event("scroll", { bubbles: true }));
      await NEXT_FRAME();
      return r.clientWidth;
    };

    const left = await at(0);
    const middle = await at(Math.round((r.scrollWidth - r.clientWidth) / 2));
    const right = await at(r.scrollWidth);

    // The whole feedback loop dies if the region's measured width never changes
    // as arrows come and go.
    expect(middle).toBe(left);
    expect(right).toBe(left);
  });

  it("cosmetic re-renders on the far-right active tab do not move the scroll position or rebuild tab DOM", async () => {
    const { tabBar } = await buildOverflowingBar(25);
    const tabs = [...tabBar.querySelectorAll<HTMLElement>(".tab")];
    const lastId = Number(tabs[tabs.length - 1].dataset.tabId);
    switchTab(lastId);
    await NEXT_FRAME();

    const r = region(tabBar);
    expect(r.scrollLeft).toBeGreaterThan(0); // active tab is genuinely far right
    const elBefore = tabBar.querySelector(`.tab[data-tab-id="${lastId}"]`);

    // Warm-up render so scrollActiveTabIntoView has settled on its resting
    // position; capture that as the baseline the loop must not drift from.
    setTabBadge(lastId, "bell");
    await NEXT_FRAME();
    const settledScroll = r.scrollLeft;

    // Frequent re-renders like OSC titles / the CWD poll / bell badges. The bug
    // was that each one restarted a smooth scroll and the bar slid forever;
    // here the position must converge — every subsequent render is a no-op.
    for (let i = 0; i < 6; i++) {
      setTabBadge(lastId, i % 2 === 0 ? null : "bell");
      await NEXT_FRAME();
      expect(r.scrollLeft).toBe(settledScroll);
    }

    // No flashing: the tab element is reused, not torn down and rebuilt.
    const elAfter = tabBar.querySelector(`.tab[data-tab-id="${lastId}"]`);
    expect(elAfter).toBe(elBefore);
  });

  it("switching to an off-screen tab brings it fully into view, then stays put", async () => {
    const { tabBar } = await buildOverflowingBar(25);
    const r = region(tabBar);

    // Jump from the far-right active tab to the first tab (far left).
    const firstEl = tabBar.querySelector<HTMLElement>(".tab")!;
    const firstId = Number(firstEl.dataset.tabId);
    switchTab(firstId);
    await NEXT_FRAME();

    const fullyVisible = (el: HTMLElement) =>
      el.offsetLeft >= r.scrollLeft && el.offsetLeft + el.offsetWidth <= r.scrollLeft + r.clientWidth;
    expect(fullyVisible(firstEl)).toBe(true);

    // The first tab is fully visible now; a redundant cosmetic render must be a
    // no-op — no further scrolling.
    const settled = r.scrollLeft;
    setTabBadge(firstId, "bell");
    await NEXT_FRAME();
    expect(r.scrollLeft).toBe(settled);
  });
});
