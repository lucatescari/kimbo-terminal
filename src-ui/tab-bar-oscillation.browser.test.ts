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
  await NEXT_FRAME();
  return { tabBar };
}

const region = (bar: HTMLElement) => bar.querySelector<HTMLElement>(".tab-scroll-region")!;

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
    const settledScroll = r.scrollLeft;
    expect(settledScroll).toBeGreaterThan(0); // active tab is genuinely far right
    const elBefore = tabBar.querySelector(`.tab[data-tab-id="${lastId}"]`);

    // Frequent re-renders like OSC titles / the CWD poll / bell badges.
    for (let i = 0; i < 6; i++) {
      setTabBadge(lastId, i % 2 === 0 ? "bell" : null);
      await NEXT_FRAME();
    }

    // No unprompted sliding: the scroll position must not drift.
    expect(r.scrollLeft).toBe(settledScroll);
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
