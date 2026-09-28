import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./terminal", () => {
  const sessions: Array<any> = [];
  let nextId = 1;
  async function createTerminalSession(parentEl: HTMLElement): Promise<any> {
    const id = nextId++;
    const container = document.createElement("div");
    container.className = "terminal-container";
    parentEl.appendChild(container);
    const session: any = {
      id, ptyId: 1000 + id, cwd: null, container, disposed: false,
      term: { focus() {}, buffer: { active: { viewportY: 0, baseY: 0 } }, scrollToBottom() {} },
      fit: { fit() {} }, search: {},
      dispose() { session.disposed = true; container.remove(); },
    };
    sessions.push(session);
    return session;
  }
  return {
    createTerminalSession,
    setTabTitleHandler: vi.fn(),
    __sessions: sessions,
    __reset: () => { sessions.length = 0; nextId = 1; },
  };
});
vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn(), resizePty: vi.fn(), closePty: vi.fn(),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

async function mount() {
  vi.resetModules();
  document.body.innerHTML = "";
  const tabBar = document.createElement("div");
  tabBar.id = "tab-bar";
  document.body.appendChild(tabBar);
  const terminalArea = document.createElement("div");
  terminalArea.id = "terminal-area";
  document.body.appendChild(terminalArea);
  const tabs = await import("./tabs");
  const terminal = (await import("./terminal")) as any;
  terminal.__reset();
  tabs.initTabs(tabBar, terminalArea);
  const tabDrag = await import("./tab-drag");
  tabDrag.initTabDrag(tabBar);
  return { tabBar, tabs, tabDrag };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("Tab drag-and-drop", () => {
  it("does not start drag below the 5px movement threshold", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.tabs.createTab();

    const scrollRegion = h.tabBar.querySelector(".tab-scroll-region")!;
    const tabEl = scrollRegion.querySelector(".tab") as HTMLElement;

    tabEl.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 10, bubbles: true }));
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 103, clientY: 10, buttons: 1, bubbles: true }));

    expect(tabEl.classList.contains("dragging")).toBe(false);
  });

  it("starts drag after exceeding 5px threshold", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.tabs.createTab();

    const scrollRegion = h.tabBar.querySelector(".tab-scroll-region")!;
    const tabEl = scrollRegion.querySelector(".tab") as HTMLElement;

    tabEl.setPointerCapture = vi.fn();
    tabEl.releasePointerCapture = vi.fn();

    tabEl.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 10, bubbles: true }));
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 107, clientY: 10, buttons: 1, bubbles: true }));

    expect(tabEl.classList.contains("dragging")).toBe(true);
  });

  it("does not initiate drag with only one tab", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const scrollRegion = h.tabBar.querySelector(".tab-scroll-region")!;
    const tabEl = scrollRegion.querySelector(".tab") as HTMLElement;

    tabEl.setPointerCapture = vi.fn();
    tabEl.releasePointerCapture = vi.fn();

    tabEl.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 10, bubbles: true }));
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 10, buttons: 1, bubbles: true }));

    expect(tabEl.classList.contains("dragging")).toBe(false);
  });

  it("cleans up drag state on pointerup", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.tabs.createTab();

    const scrollRegion = h.tabBar.querySelector(".tab-scroll-region")!;
    const tabEl = scrollRegion.querySelector(".tab") as HTMLElement;

    tabEl.setPointerCapture = vi.fn();
    tabEl.releasePointerCapture = vi.fn();

    tabEl.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 10, bubbles: true }));
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 107, clientY: 10, buttons: 1, bubbles: true }));
    expect(tabEl.classList.contains("dragging")).toBe(true);

    tabEl.dispatchEvent(new PointerEvent("pointerup", { clientX: 107, clientY: 10, bubbles: true }));
    expect(tabEl.classList.contains("dragging")).toBe(false);
    expect(tabEl.style.transform).toBe("");
  });

  // A tab could end up permanently unclickable: `.dragging` sets
  // pointer-events:none, and it was left on the tab whenever a press started a
  // drag whose release the tab never saw. Plain hover then armed the drag, and
  // the next press on another tab orphaned the class for the rest of the session.
  describe("a tab never gets stuck in .dragging", () => {
    async function twoTabs() {
      const h = await mount();
      await h.tabs.createTab();
      await h.tabs.createTab();
      const [a, b] = Array.from(h.tabBar.querySelectorAll<HTMLElement>(".tab"));
      for (const el of [a, b]) {
        el.setPointerCapture = vi.fn();
        el.releasePointerCapture = vi.fn();
      }
      return { ...h, a, b };
    }
    const down = (el: HTMLElement, x: number, button = 0) =>
      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: 10, button, buttons: button === 0 ? 1 : 2, bubbles: true }));
    const move = (el: EventTarget, x: number, buttons: number) =>
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: 10, buttons, bubbles: true }));
    const up = (el: EventTarget, x: number) =>
      el.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: 10, bubbles: true }));

    it("a right-click never starts a drag, even when the release lands on the context menu", async () => {
      const { a } = await twoTabs();
      down(a, 100, 2);
      up(document.body, 101);
      move(a, 120, 0);
      expect(a.classList.contains("dragging")).toBe(false);
    });

    it("hovering after a press released outside the tab does not start a drag", async () => {
      const { a } = await twoTabs();
      down(a, 100);
      up(document.body, 102);
      move(a, 120, 0);
      expect(a.classList.contains("dragging")).toBe(false);
    });

    it("hovering with no button held does not start a drag even if the release was never delivered", async () => {
      const { a } = await twoTabs();
      down(a, 100);
      move(a, 120, 0);
      expect(a.classList.contains("dragging")).toBe(false);
    });

    it("a release outside the tab ends an active drag", async () => {
      const { a } = await twoTabs();
      down(a, 100);
      move(a, 110, 1);
      expect(a.classList.contains("dragging")).toBe(true);
      up(document.body, 110);
      expect(a.classList.contains("dragging")).toBe(false);
      expect(a.style.transform).toBe("");
    });

    it("a new press on another tab cleans up the previous tab", async () => {
      const { a, b } = await twoTabs();
      down(a, 100);
      move(a, 110, 1);
      expect(a.classList.contains("dragging")).toBe(true);
      down(b, 300);
      expect(a.classList.contains("dragging")).toBe(false);
      expect(a.style.transform).toBe("");
    });
  });
});
