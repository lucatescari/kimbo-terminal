import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drop routing across multiple panes. Originally written to reproduce the
// "drops always land on the first pane of the tab" bug; now also guards the
// fix that switched routing from `document.elementFromPoint` (fragile under
// the macOS drag overlay) to bounding-rect math, and from "always divide by
// DPR" to "try raw, fall back to divided".

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let capturedDragDropHandler:
  | ((event: { payload: any }) => void)
  | null = null;

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (event: { payload: any }) => void) => {
      capturedDragDropHandler = handler;
      return () => {};
    },
  }),
}));

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
      id,
      ptyId: 1000 + id,
      cwd: null,
      container,
      disposed: false,
      term: {
        focus() {},
        paste: vi.fn(),
        buffer: { active: { viewportY: 0, baseY: 0 } },
        scrollToBottom() {},
      },
      fit: { fit() {} },
      search: {},
      dispose() {
        session.disposed = true;
        container.remove();
      },
    };
    sessions.push(session);
    return session;
  }
  return {
    createTerminalSession,
    setTabTitleHandler: vi.fn(),
    __sessions: sessions,
    __reset: () => {
      sessions.length = 0;
      nextId = 1;
    },
  };
});

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn(),
  resizePty: vi.fn(),
  closePty: vi.fn(),
  getCwd: vi.fn().mockResolvedValue(null),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Harness = {
  pane1El: HTMLElement;
  pane2El: HTMLElement;
  pane1Id: number;
  pane2Id: number;
  sessions: Array<any>;
};

async function mountTwoPanes(): Promise<Harness> {
  capturedDragDropHandler = null;
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
  await tabs.createTab();

  const panes = await import("./panes");
  await panes.splitActive("vertical");

  // splitActive focuses the new (right) pane. The bug scenario assumes the
  // user has the left pane active when they drop, so flip focus back.
  const leaves = document.querySelectorAll<HTMLElement>(".pane");
  expect(leaves.length).toBe(2);
  const pane1El = leaves[0];
  const pane2El = leaves[1];
  const pane1Id = Number(pane1El.dataset.paneId);
  const pane2Id = Number(pane2El.dataset.paneId);
  panes.setActivePane(pane1Id);
  expect(panes.getActivePaneId()).toBe(pane1Id);

  // jsdom doesn't lay things out; pin pane rects so getBoundingClientRect
  // returns the vertical-split geometry the routing fix relies on.
  // Layout: viewport 1000 wide, pane 1 = 0–500, pane 2 = 500–1000.
  pane1El.getBoundingClientRect = () => rect(0, 0, 500, 400);
  pane2El.getBoundingClientRect = () => rect(500, 0, 1000, 400);

  return { pane1El, pane2El, pane1Id, pane2Id, sessions: terminal.__sessions };
}

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left, top, right, bottom,
    x: left, y: top,
    width: right - left, height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  document.body.innerHTML = "";
  capturedDragDropHandler = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("drag-drop: drop routing across multiple panes", () => {
  it("with DPR=1, dropping over pane 2 pastes into pane 2 (not the active pane 1)", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });

    const h = await mountTwoPanes();

    const { initDragDrop } = await import("./drag-drop");
    await initDragDrop();
    expect(capturedDragDropHandler).not.toBeNull();

    // Drop on pane 2's region (x=800 is between 500 and 1000).
    capturedDragDropHandler!({
      payload: {
        type: "drop",
        position: { x: 800, y: 50 },
        paths: ["/tmp/photo.png"],
      },
    });

    const pane1Session = h.sessions[0];
    const pane2Session = h.sessions[1];
    expect(pane2Session.term.paste).toHaveBeenCalledWith("'/tmp/photo.png'");
    expect(pane1Session.term.paste).not.toHaveBeenCalled();
  });

  it("with DPR=2 and physical-pixel coords, the divide-by-DPR fallback routes to pane 2", async () => {
    // Mechanism A: Tauri delivers the documented PhysicalPosition. Raw coords
    // 1600,100 fall outside the (0..1000) viewport, so the routing falls
    // through to the divided interpretation 800,50 — which is on pane 2.
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

    const h = await mountTwoPanes();

    const { initDragDrop } = await import("./drag-drop");
    await initDragDrop();

    capturedDragDropHandler!({
      payload: {
        type: "drop",
        position: { x: 800 * 2, y: 50 * 2 },
        paths: ["/tmp/photo.png"],
      },
    });

    const pane1Session = h.sessions[0];
    const pane2Session = h.sessions[1];
    expect(pane2Session.term.paste).toHaveBeenCalledWith("'/tmp/photo.png'");
    expect(pane1Session.term.paste).not.toHaveBeenCalled();
  });

  it("with DPR=2 and CSS-pixel coords (Tauri quirk), raw interpretation still finds pane 2", async () => {
    // Mechanism B (the actual user-reported bug): on this macOS / Tauri build
    // the payload comes through in CSS px instead of physical px. The old code
    // unconditionally divided by DPR, halving the coords and routing every
    // drop into pane 1's region. The fix tries the raw coords first, so the
    // CSS-px payload still resolves to the pane under the cursor.
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

    const h = await mountTwoPanes();

    const { initDragDrop } = await import("./drag-drop");
    await initDragDrop();

    capturedDragDropHandler!({
      payload: {
        type: "drop",
        position: { x: 800, y: 50 },
        paths: ["/tmp/photo.png"],
      },
    });

    const pane1Session = h.sessions[0];
    const pane2Session = h.sessions[1];
    expect(pane2Session.term.paste).toHaveBeenCalledWith("'/tmp/photo.png'");
    expect(pane1Session.term.paste).not.toHaveBeenCalled();
  });

  it("dropping outside any pane (e.g. tab bar) falls back to the active pane", async () => {
    // Defines the legitimate fallback: if the cursor isn't over any pane —
    // tab bar, split-handle gutter, off-window — we don't have a sensible
    // spatial target, so route to whatever the user last focused. This is
    // the documented escape hatch, not the bug.
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });

    const h = await mountTwoPanes();

    const { initDragDrop } = await import("./drag-drop");
    await initDragDrop();

    capturedDragDropHandler!({
      payload: {
        type: "drop",
        position: { x: 800, y: 4000 }, // y far below both panes
        paths: ["/tmp/photo.png"],
      },
    });

    const pane1Session = h.sessions[0];
    const pane2Session = h.sessions[1];
    expect(pane1Session.term.paste).toHaveBeenCalledWith("'/tmp/photo.png'");
    expect(pane2Session.term.paste).not.toHaveBeenCalled();
  });
});
