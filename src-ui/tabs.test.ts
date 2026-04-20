import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration test for Cmd+W / closeActiveOrTab behavior.
//
// The previous regression guard (panes.test.ts) re-implemented the dispatch
// decision as a pure function, so it couldn't catch bugs in the REAL pane
// close path (DOM removal, session.dispose, tree mutation, focus handoff).
// This file drives tabs.ts + panes.ts through jsdom with the terminal layer
// mocked out — we assert visible post-conditions after a Cmd+W:
//
//   1. On a split, the ACTIVE pane's DOM element is gone AND its session is
//      disposed AND exactly one pane stays.
//   2. On a single-pane tab with siblings, the whole tab is gone AND all of
//      its pane sessions are disposed (no leaked PTYs).
//   3. On the very last tab with a single pane, Cmd+W is a no-op.
//   4. Firing Cmd+W twice in a row (macOS can dispatch both a menu-action
//      AND a keydown from one physical press) never closes more than one
//      pane/tab and never leaves an orphan pane frame.
//
// Why the gymnastics with vi.resetModules() in beforeEach: tabs.ts and
// panes.ts hold module-level state (tab array, pane tree, next-id counters).
// Running 6 tests against the same loaded module would have them step on
// each other. We dump + re-import the graph before every test.
// ---------------------------------------------------------------------------

// Mock tauri core/events so the module graph doesn't try to talk to Rust.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// Mock the terminal module — createTerminalSession returns a stub that
// mirrors the real contract: it appends a `.terminal-container` child to the
// parent element and exposes a dispose() that removes that child. Every
// created session is tracked in `__sessions` so tests can assert disposal.
vi.mock("./terminal", () => {
  const sessions: Array<any> = [];
  let nextId = 1;

  async function createTerminalSession(parentEl: HTMLElement): Promise<any> {
    const id = nextId++;
    const container = document.createElement("div");
    container.className = "terminal-container";
    container.dataset.sessionId = String(id);
    parentEl.appendChild(container);

    const session: any = {
      id,
      ptyId: 1000 + id,
      cwd: null,
      container,
      disposed: false,
      term: { focus() {}, buffer: { active: { viewportY: 0, baseY: 0 } }, scrollToBottom() {} },
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
    __reset: () => { sessions.length = 0; nextId = 1; },
  };
});

// Mock ./pty so the command calls resolve synchronously in tests.
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
// Test harness: rebuild DOM + re-import modules before every test so the
// internal tabs[]/tree state is never stale.
// ---------------------------------------------------------------------------

interface Harness {
  tabBar: HTMLElement;
  terminalArea: HTMLElement;
  tabs: typeof import("./tabs");
  panes: typeof import("./panes");
  sessions: Array<any>;
}

async function mount(): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";

  const tabBar = document.createElement("div");
  tabBar.id = "tab-bar";
  document.body.appendChild(tabBar);
  const terminalArea = document.createElement("div");
  terminalArea.id = "terminal-area";
  document.body.appendChild(terminalArea);

  const tabs = await import("./tabs");
  const panes = await import("./panes");
  const terminal = (await import("./terminal")) as any;
  terminal.__reset();

  tabs.initTabs(tabBar, terminalArea);
  return { tabBar, terminalArea, tabs, panes, sessions: terminal.__sessions };
}

beforeEach(() => {
  // Nothing: mount() is per-test so we can await the dynamic imports.
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

describe("Cmd+W on a split pane", () => {
  it("removes the active pane's DOM element AND disposes its session", async () => {
    const h = await mount();
    await h.tabs.createTab();
    // Use panes.splitActive directly (async); tabs.splitActive fires-and-forgets.
    await h.panes.splitActive("vertical");

    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(2);
    const activeSession = h.sessions[h.sessions.length - 1];
    expect(activeSession.disposed).toBe(false);

    h.tabs.closeActiveOrTab();

    expect(
      h.terminalArea.querySelectorAll(".pane").length,
      "exactly one pane should remain — the other pane AND its frame must both be gone",
    ).toBe(1);
    expect(
      activeSession.disposed,
      "the closed pane's terminal session must be disposed (PTY freed)",
    ).toBe(true);

    // No orphan .terminal-container should be left over.
    expect(h.terminalArea.querySelectorAll(".terminal-container").length).toBe(1);
  });

  it("collapses nested split trees correctly (no orphaned pane frames)", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.panes.splitActive("vertical");
    await h.panes.splitActive("horizontal");

    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(3);

    h.tabs.closeActiveOrTab();

    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(2);

    // Every remaining .pane MUST contain exactly one .terminal-container.
    // A "ghost pane" (frame with no terminal inside) is the exact visual
    // symptom: "Cmd+W closes only the terminal, leaves the pane".
    for (const pane of h.terminalArea.querySelectorAll(".pane")) {
      expect(
        pane.querySelectorAll(".terminal-container").length,
        "each remaining .pane must still host its .terminal-container",
      ).toBe(1);
    }
  });
});

describe("Cmd+W on a single-pane tab", () => {
  it("when multiple tabs exist: closes the whole tab AND disposes its pane sessions", async () => {
    const h = await mount();
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab();
    expect(h.tabs.getActiveTab()?.id).toBe(tabB.id);

    // Two tabs, one session each.
    expect(h.sessions.length).toBe(2);
    const tabBSession = h.sessions[1];
    expect(tabBSession.disposed).toBe(false);

    h.tabs.closeActiveOrTab();

    expect(tabB.container.isConnected).toBe(false);
    expect(tabA.container.isConnected).toBe(true);
    expect(
      tabBSession.disposed,
      "closing a tab must dispose its pane sessions (no leaked PTYs)",
    ).toBe(true);
  });

  it("when it's the last tab: is a no-op (does not crash, DOM unchanged)", async () => {
    const h = await mount();
    const onlyTab = await h.tabs.createTab();
    const panesBefore = h.terminalArea.querySelectorAll(".pane").length;

    expect(() => h.tabs.closeActiveOrTab()).not.toThrow();

    expect(onlyTab.container.isConnected).toBe(true);
    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(panesBefore);
    expect(h.sessions[0].disposed).toBe(false);
  });
});

describe("Cmd+W close-order resilience (no zombie panes)", () => {
  // User-reported regression: "Cmd+W closes only the terminal, not the pane".
  //
  // The shape of this bug is an ordering fragility in closeActive(): the
  // destructive side-effect (session.dispose(), which synchronously detaches
  // the .terminal-container from the DOM) runs BEFORE the DOM swap that
  // removes the outer .pane frame. If anything between those two steps
  // throws — real xterm/webgl dispose can, especially on GPU context loss or
  // during teardown while async work is in flight — the user is left with
  // the exact zombie state: terminal gone, empty .pane frame still on screen.
  //
  // These tests lock in the invariant: after a Cmd+W, no .pane may exist
  // without its .terminal-container, regardless of whether dispose fails.

  it("if session.dispose throws partway, the .pane is still removed", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.panes.splitActive("vertical");

    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(2);

    // Simulate a real-world partial-dispose failure: the xterm teardown
    // detaches its .terminal-container (as the real dispose does as a side
    // effect) and THEN throws before the outer pane is removed. This is
    // what term.dispose() / webgl cleanup can do under GPU context loss.
    const activeSession = h.sessions[h.sessions.length - 1];
    const originalContainer = activeSession.container;
    activeSession.dispose = () => {
      activeSession.disposed = true;
      originalContainer.remove();
      throw new Error("simulated term.dispose() failure");
    };

    // The close call should not propagate the dispose error up to the
    // keydown handler — it's the caller's job to swallow cleanup failures.
    expect(() => h.tabs.closeActiveOrTab()).not.toThrow();

    // Invariant: every .pane must still host its .terminal-container.
    // A .pane with no .terminal-container is the exact zombie-frame state
    // the user reported as "Cmd+W closes only the terminal".
    const panes = h.terminalArea.querySelectorAll(".pane");
    expect(panes.length, "exactly one pane should remain after Cmd+W").toBe(1);
    for (const pane of panes) {
      expect(
        pane.querySelectorAll(".terminal-container").length,
        "a .pane with no .terminal-container is the user-reported zombie state",
      ).toBe(1);
    }
  });

  it("a second Cmd+W after a failed dispose still works (guard must reset)", async () => {
    // The re-entrancy guard (closeInFlight) must not get wedged if closeActive
    // throws. Otherwise the user's first Cmd+W leaves a broken state AND
    // their second Cmd+W is silently ignored — a double failure.
    const h = await mount();
    await h.tabs.createTab();
    await h.panes.splitActive("vertical");
    await h.panes.splitActive("horizontal"); // 3 panes

    const firstActive = h.sessions[h.sessions.length - 1];
    firstActive.dispose = () => {
      firstActive.disposed = true;
      firstActive.container.remove();
      throw new Error("boom");
    };

    expect(() => h.tabs.closeActiveOrTab()).not.toThrow();

    // Wait one animation frame so the re-entrancy guard resets.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // Second Cmd+W on a now-2-pane tab should still close another pane.
    h.tabs.closeActiveOrTab();

    const panes = h.terminalArea.querySelectorAll(".pane");
    expect(panes.length).toBe(1);
    for (const pane of panes) {
      expect(pane.querySelectorAll(".terminal-container").length).toBe(1);
    }
  });
});

describe("Cmd+W double-dispatch (menu accelerator + webview keydown)", () => {
  // On macOS, a native menu item with CmdOrCtrl+W can fire BOTH the menu-action
  // event AND let the keydown bubble to the webview. Both paths ultimately
  // call closeActiveOrTab(). If firing twice collapses more than intended —
  // e.g., one press closes a pane AND then another tab's pane — that's a
  // silent multi-close bug. The user-reported symptom was "cmd+w closes only
  // the terminal, and again cmd+w closes the pane" — which is exactly what
  // happens when the first dispatch collapses a split to a leaf, and the
  // second dispatch then closes the newly-leaf tab (or worse, cascades).
  it("firing closeActiveOrTab twice on a 2-pane split closes exactly one pane", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.panes.splitActive("vertical");

    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(2);

    // Simulate: one real Cmd+W press → both the menu listener AND the
    // document keydown listener dispatch closeActiveOrTab. They run
    // back-to-back from the user's POV.
    h.tabs.closeActiveOrTab();
    h.tabs.closeActiveOrTab();

    expect(
      h.terminalArea.querySelectorAll(".pane").length,
      "a single physical Cmd+W press must not close two panes",
    ).toBe(1);

    const t = h.panes.getTree();
    expect(t?.type).toBe("leaf");
  });

  it("firing closeActiveOrTab twice when multiple tabs exist does not cascade into closing another tab", async () => {
    const h = await mount();
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab();
    const tabC = await h.tabs.createTab();

    h.tabs.closeActiveOrTab();
    h.tabs.closeActiveOrTab();

    expect(tabA.container.isConnected).toBe(true);
    expect(tabB.container.isConnected).toBe(true);
    expect(tabC.container.isConnected).toBe(false);
  });

  // The exact shape of the user-reported regression: a split pane in a tab
  // that has siblings. First dispatch closes the pane. WITHOUT the guard,
  // the second dispatch sees the tree is now a leaf and proceeds to close
  // the whole TAB — the user perceived this as "Cmd+W closed the terminal
  // AND then the pane (tab)". With the guard in place, only the pane goes.
  it("2-pane split in a tab with siblings: one Cmd+W press closes ONE pane, not the tab", async () => {
    const h = await mount();
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab(); // sibling tab exists
    expect(h.tabs.getActiveTab()?.id).toBe(tabB.id);
    await h.panes.splitActive("vertical"); // tab B now has a 2-pane split

    // Active tab (B) has 2 panes; inactive tab A has 1 pane of its own.
    expect(tabB.container.querySelectorAll(".pane").length).toBe(2);

    // Simulate the double-dispatch (menu-action + keydown) on one press.
    h.tabs.closeActiveOrTab();
    h.tabs.closeActiveOrTab();

    // Tab B must still be the active tab, still on screen, with one pane.
    expect(tabB.container.isConnected).toBe(true);
    expect(tabA.container.isConnected).toBe(true);
    expect(h.tabs.getActiveTab()?.id).toBe(tabB.id);
    expect(tabB.container.querySelectorAll(".pane").length).toBe(1);
    expect(h.panes.getTree()?.type).toBe("leaf");
  });
});
