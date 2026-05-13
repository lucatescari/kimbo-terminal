import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard: a .split-handle inside a freshly-split pane must respond
// to pointer drag and resize the first sibling's flex basis. Before this fix,
// the handle had only the CSS resize cursor — no JS listener — so the divider
// looked draggable but wasn't. Pair test of split-handle-drag.test.ts: that
// covers the drag module in isolation, this asserts panes.ts actually wires
// the module to every handle it creates, including across multiple tabs.

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
  return { tabBar, terminalArea, tabs };
}

/** Stub getBoundingClientRect on the split container and its first child so the
 *  drag logic sees a real layout. jsdom returns zeros otherwise. */
function stubLayout(splitEl: HTMLElement, containerW: number, firstW: number) {
  const containerRect = { left: 0, top: 0, right: containerW, bottom: 100, width: containerW, height: 100, x: 0, y: 0, toJSON: () => ({}) };
  const firstRect = { left: 0, top: 0, right: firstW, bottom: 100, width: firstW, height: 100, x: 0, y: 0, toJSON: () => ({}) };
  splitEl.getBoundingClientRect = () => containerRect as DOMRect;
  const first = splitEl.firstElementChild as HTMLElement;
  first.getBoundingClientRect = () => firstRect as DOMRect;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("panes: split-handle drag is wired up", () => {
  it("the handle created by splitActive resizes the first sibling on drag", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const panes = await import("./panes");
    await panes.splitActive("vertical");

    const splitEl = document.querySelector(".pane-container.vertical") as HTMLElement;
    expect(splitEl).not.toBeNull();
    const handle = splitEl.querySelector(":scope > .split-handle") as HTMLElement;
    expect(handle).not.toBeNull();
    const first = splitEl.firstElementChild as HTMLElement;

    stubLayout(splitEl, 1000, 500);
    (handle as any).setPointerCapture = vi.fn();
    (handle as any).releasePointerCapture = vi.fn();

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 620, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 620, clientY: 50, bubbles: true }));

    expect(first.style.flex).toBe("0 0 620px");
  });

  it("the horizontal handle resizes vertically on drag", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const panes = await import("./panes");
    await panes.splitActive("horizontal");

    const splitEl = document.querySelector(".pane-container.horizontal") as HTMLElement;
    const handle = splitEl.querySelector(":scope > .split-handle") as HTMLElement;
    const first = splitEl.firstElementChild as HTMLElement;

    // For horizontal we re-stub: width axis irrelevant, height is what matters.
    const containerRect = { left: 0, top: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON: () => ({}) };
    const firstRect = { left: 0, top: 0, right: 100, bottom: 400, width: 100, height: 400, x: 0, y: 0, toJSON: () => ({}) };
    splitEl.getBoundingClientRect = () => containerRect as DOMRect;
    first.getBoundingClientRect = () => firstRect as DOMRect;

    (handle as any).setPointerCapture = vi.fn();
    (handle as any).releasePointerCapture = vi.fn();

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 50, clientY: 400, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 50, clientY: 480, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 50, clientY: 480, bubbles: true }));

    expect(first.style.flex).toBe("0 0 480px");
  });

  it("the divider still drags after switching between multiple tabs", async () => {
    // This is the regression the user reported as 'we killed the divider when
    // we have more than 1 tab'. The drag wire-up has to survive the
    // setTree/disposeTree dance that tab-switching does.
    const h = await mount();
    const tab1 = await h.tabs.createTab(); // tab 1
    const tab2 = await h.tabs.createTab(); // tab 2 — now active

    const panes = await import("./panes");
    await panes.splitActive("vertical"); // split inside tab 2

    // Switch away then back — exercises saveCurrentTabTree / setTree which
    // restore the snapshot DOM. The drag listener must survive that round-trip.
    h.tabs.switchTab(tab1.id);
    h.tabs.switchTab(tab2.id);

    const splitEl = document.querySelector(".pane-container.vertical") as HTMLElement;
    expect(splitEl).not.toBeNull();
    const handle = splitEl.querySelector(":scope > .split-handle") as HTMLElement;
    expect(handle).not.toBeNull();
    const first = splitEl.firstElementChild as HTMLElement;

    stubLayout(splitEl, 1000, 500);
    (handle as any).setPointerCapture = vi.fn();
    (handle as any).releasePointerCapture = vi.fn();

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 700, clientY: 50, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 700, clientY: 50, bubbles: true }));

    expect(first.style.flex).toBe("0 0 700px");
  });
});
