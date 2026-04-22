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
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 103, clientY: 10, bubbles: true }));

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
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 107, clientY: 10, bubbles: true }));

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
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 10, bubbles: true }));

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
    tabEl.dispatchEvent(new PointerEvent("pointermove", { clientX: 107, clientY: 10, bubbles: true }));
    expect(tabEl.classList.contains("dragging")).toBe(true);

    tabEl.dispatchEvent(new PointerEvent("pointerup", { clientX: 107, clientY: 10, bubbles: true }));
    expect(tabEl.classList.contains("dragging")).toBe(false);
    expect(tabEl.style.transform).toBe("");
  });
});
