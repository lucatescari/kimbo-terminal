import { afterEach, describe, expect, it, vi } from "vitest";

// Regression guard for a user-reported bug: with two panes in a window, drag
// the divider to resize them, then close one pane. The surviving pane must
// expand to fill the whole window. Before the fix it kept the fixed flex
// basis the drag had pinned onto it (`flex: 0 0 Npx`), so the last remaining
// pane stayed at its dragged width instead of going full-size.
//
// Root cause: split-handle-drag rewrites the FIRST sibling's flex to a fixed
// basis on drag. closeActive() promotes the surviving sibling by swapping it
// in for the split container in the DOM, but never reset that inline flex.

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

function stubLayout(splitEl: HTMLElement, containerW: number, firstW: number) {
  const containerRect = { left: 0, top: 0, right: containerW, bottom: 100, width: containerW, height: 100, x: 0, y: 0, toJSON: () => ({}) };
  const firstRect = { left: 0, top: 0, right: firstW, bottom: 100, width: firstW, height: 100, x: 0, y: 0, toJSON: () => ({}) };
  splitEl.getBoundingClientRect = () => containerRect as DOMRect;
  const first = splitEl.firstElementChild as HTMLElement;
  first.getBoundingClientRect = () => firstRect as DOMRect;
}

/** Drag the divider so the first sibling gets a fixed flex basis. */
function dragHandle(splitEl: HTMLElement) {
  const handle = splitEl.querySelector<HTMLElement>(":scope > .split-handle")!;
  stubLayout(splitEl, 1000, 500);
  (handle as any).setPointerCapture = vi.fn();
  (handle as any).releasePointerCapture = vi.fn();
  handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 50, button: 0, bubbles: true }));
  handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 700, clientY: 50, bubbles: true }));
  handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 700, clientY: 50, bubbles: true }));
}

afterEach(() => { document.body.innerHTML = ""; });

describe("panes: closing a pane after a resize drag", () => {
  it("the surviving first pane fills the window (flex reset, not pinned to dragged width)", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const panes = await import("./panes");
    await panes.splitActive("vertical");

    const splitEl = document.querySelector(".pane-container.vertical") as HTMLElement;
    const first = splitEl.firstElementChild as HTMLElement;

    dragHandle(splitEl);
    expect(first.style.flex).toBe("0 0 700px"); // sanity: drag pinned the first pane

    // Active pane is the SECOND (split focuses the new pane). Closing it leaves
    // the resized FIRST pane as the sole survivor.
    panes.closeActive();

    // The window should now contain a single full-size pane. `flex: 1` is
    // serialized by jsdom as the expanded `1 1 0%` shorthand — same form a
    // fresh root pane gets from createLeaf.
    expect(document.querySelector(".pane-container.vertical")).toBeNull();
    expect(first.style.flex).toBe("1 1 0%");
  });

  it("the surviving second pane fills the window when the first is closed", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const panes = await import("./panes");
    await panes.splitActive("vertical");

    const splitEl = document.querySelector(".pane-container.vertical") as HTMLElement;
    const first = splitEl.firstElementChild as HTMLElement;
    const second = splitEl.querySelector<HTMLElement>(":scope > .pane:last-child")
      ?? (splitEl.children[2] as HTMLElement);

    dragHandle(splitEl);

    // Focus and close the FIRST pane (paneId of the first leaf).
    const firstPaneId = Number(first.dataset.paneId);
    panes.setActivePane(firstPaneId);
    panes.closeActive();

    expect(document.querySelector(".pane-container.vertical")).toBeNull();
    expect(second.style.flex).toBe("1 1 0%");
  });
});
