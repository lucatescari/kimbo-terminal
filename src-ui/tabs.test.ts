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

  // Wrap createTerminalSession in vi.fn so per-test assertions can inspect
  // its call args — specifically the third arg (restoredScrollback) which
  // the reopen flow plumbs through. The body still mirrors the real
  // contract: appends a .terminal-container to the parent and returns a
  // session whose dispose() removes it.
  const createTerminalSession = vi.fn(
    async (
      parentEl: HTMLElement,
      _cwd?: string,
      _restoredScrollback?: string,
      _restoredClaudeResume?: { uuid: string },
    ): Promise<any> => {
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
        // Default empty serialize so existing tests don't accidentally
        // capture scrollback. Per-test overrides set this to a known value.
        serialize: vi.fn().mockReturnValue(""),
        dispose() {
          session.disposed = true;
          container.remove();
        },
      };
      sessions.push(session);
      return session;
    },
  );

  return {
    createTerminalSession,
    setTabTitleHandler: vi.fn(),
    __sessions: sessions,
    __reset: () => {
      sessions.length = 0;
      nextId = 1;
      createTerminalSession.mockClear();
    },
  };
});

// Mock the claude-session-probe so closeTab's per-leaf probe is
// deterministic. Per-test overrides set it to return a uuid.
vi.mock("./claude-session-probe", () => ({
  probeClaudeSession: vi.fn().mockResolvedValue(null),
}));

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

// Mocked so a test can prove renderTabBar() did NOT run: renderTabBar calls
// renderTitle at its end, whereas setTabActivity patches the button in place
// and never does. Identity of the tab element cannot distinguish the two,
// because renderTabBar reuses cached elements.
vi.mock("./title-bar", () => ({
  initTitleBar: vi.fn(),
  renderTitle: vi.fn(),
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
  terminal: typeof import("./terminal");
  probe: typeof import("./claude-session-probe");
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
  const probe = await import("./claude-session-probe");
  terminal.__reset();
  (probe.probeClaudeSession as any).mockReset();
  (probe.probeClaudeSession as any).mockResolvedValue(null);

  tabs.initTabs(tabBar, terminalArea);
  return { tabBar, terminalArea, tabs, panes, sessions: terminal.__sessions, terminal, probe };
}

beforeEach(() => {
  // Nothing: mount() is per-test so we can await the dynamic imports.
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

describe("snapshotOpenTabs cwd source (shell-agnostic restore)", () => {
  // Regression: "resume tabs" only restored the working directory on shells
  // that emit OSC 7 (oh-my-zsh installs the prompt hook; a bare zsh does
  // not), because the snapshot trusted session.cwd — the OSC-7-only field.
  // The snapshot must instead prefer the OS-level cwd query, which works on
  // every shell.
  it("prefers the OS-level cwd so restore works without OSC 7 / oh-my-zsh", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const pty = await import("./pty");
    // Bare shell: OSC 7 never fired, so session.cwd stays null...
    expect(h.sessions[0].cwd).toBeNull();
    // ...but the OS query (proc_pidinfo / /proc) returns the real cwd.
    (pty.getCwd as any).mockResolvedValue("/Users/luca/project");

    const snap = await h.tabs.snapshotOpenTabs();

    expect(snap.tabs[0].cwd).toBe("/Users/luca/project");
  });

  it("falls back to the OSC 7 cwd when the OS query returns null", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const pty = await import("./pty");
    (pty.getCwd as any).mockResolvedValue(null);
    h.sessions[0].cwd = "/from/osc7";

    const snap = await h.tabs.snapshotOpenTabs();

    expect(snap.tabs[0].cwd).toBe("/from/osc7");
  });
});

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
    await new Promise<void>((r) => setTimeout(r, 0));

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
    await new Promise<void>((r) => setTimeout(r, 0));

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

describe("Tab reordering", () => {
  it("reorderTab moves a tab from one index to another", async () => {
    const h = await mount();
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab();
    const tabC = await h.tabs.createTab();

    // Move tab C (index 2) to index 0
    h.tabs.reorderTab(2, 0);

    // Tab buttons in scroll region should be C, A, B
    const scrollRegion = h.tabBar.querySelector(".tab-scroll-region")!;
    const tabEls = scrollRegion.querySelectorAll(".tab");
    expect(tabEls[0].getAttribute("data-tab-id")).toBe(String(tabC.id));
    expect(tabEls[1].getAttribute("data-tab-id")).toBe(String(tabA.id));
    expect(tabEls[2].getAttribute("data-tab-id")).toBe(String(tabB.id));
  });

  it("reorderTab updates Cmd+1-9 mapping (visual order)", async () => {
    const h = await mount();
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab();
    const tabC = await h.tabs.createTab();

    // Move tab C (index 2) to index 0
    h.tabs.reorderTab(2, 0);

    // switchToTab(0) should now activate tab C
    h.tabs.switchToTab(0);
    expect(h.tabs.getActiveTab()?.id).toBe(tabC.id);

    // switchToTab(2) should now activate tab B
    h.tabs.switchToTab(2);
    expect(h.tabs.getActiveTab()?.id).toBe(tabB.id);
  });

  it("reorderTab is a no-op if from === to", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const tabB = await h.tabs.createTab();
    await h.tabs.createTab();

    h.tabs.switchTab(tabB.id);
    h.tabs.reorderTab(1, 1);

    expect(h.tabs.getActiveTab()?.id).toBe(tabB.id);
  });

  it("reorderTab with only one tab is a no-op", async () => {
    const h = await mount();
    const tabA = await h.tabs.createTab();

    h.tabs.reorderTab(0, 0);
    expect(h.tabs.getActiveTab()?.id).toBe(tabA.id);
  });
});

describe("beginRenameTab (inline rename editor)", () => {
  function renameInput(h: Harness, tabId: number): HTMLInputElement {
    const input = h.tabBar.querySelector<HTMLInputElement>(
      `[data-tab-id="${tabId}"] .tab-rename-input`,
    );
    if (!input) throw new Error("rename input not found");
    return input;
  }

  it("Enter commits the typed name to userName", async () => {
    const h = await mount();
    const tab = await h.tabs.createTab();

    h.tabs.beginRenameTab(tab.id);
    const input = renameInput(h, tab.id);
    input.value = "My Project";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(h.tabs.findTabById(tab.id)?.userName).toBe("My Project");
    // Label restored with the new name.
    const label = h.tabBar.querySelector(`[data-tab-id="${tab.id}"] .tab-label`);
    expect(label?.textContent).toBe("My Project");
  });

  it("Escape cancels without writing userName (no blur double-commit)", async () => {
    const h = await mount();
    const tab = await h.tabs.createTab();
    const before = h.tabs.findTabById(tab.id)?.name;

    h.tabs.beginRenameTab(tab.id);
    const input = renameInput(h, tab.id);
    input.value = "Should Not Stick";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(h.tabs.findTabById(tab.id)?.userName).toBeUndefined();
    const label = h.tabBar.querySelector(`[data-tab-id="${tab.id}"] .tab-label`);
    expect(label?.textContent).toBe(before);
  });

  it("blur commits the typed name", async () => {
    const h = await mount();
    const tab = await h.tabs.createTab();

    h.tabs.beginRenameTab(tab.id);
    const input = renameInput(h, tab.id);
    input.value = "Via Blur";
    input.dispatchEvent(new FocusEvent("blur"));

    expect(h.tabs.findTabById(tab.id)?.userName).toBe("Via Blur");
  });

  it("empty value clears userName (reverts to auto name)", async () => {
    const h = await mount();
    const tab = await h.tabs.createTab();
    // First set a sticky name.
    h.tabs.beginRenameTab(tab.id);
    renameInput(h, tab.id).value = "Sticky";
    h.tabBar
      .querySelector<HTMLInputElement>(`[data-tab-id="${tab.id}"] .tab-rename-input`)!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(h.tabs.findTabById(tab.id)?.userName).toBe("Sticky");

    // Now clear it.
    h.tabs.beginRenameTab(tab.id);
    const input = renameInput(h, tab.id);
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(h.tabs.findTabById(tab.id)?.userName).toBeUndefined();
  });

  it("caps the committed name at 64 characters", async () => {
    const h = await mount();
    const tab = await h.tabs.createTab();

    h.tabs.beginRenameTab(tab.id);
    const input = renameInput(h, tab.id);
    input.value = "x".repeat(100);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(h.tabs.findTabById(tab.id)?.userName?.length).toBe(64);
  });

  it("double-click on a tab opens the rename input", async () => {
    const h = await mount();
    const tab = await h.tabs.createTab();

    const el = h.tabBar.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`)!;
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(
      h.tabBar.querySelector(`[data-tab-id="${tab.id}"] .tab-rename-input`),
    ).not.toBeNull();
  });
});

describe("Tab bar scroll region structure", () => {
  it("renderTabBar creates scroll arrows + scroll region + new-tab button", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const tabBar = h.tabBar;
    const leftArrow = tabBar.querySelector(".tab-scroll-arrow.left");
    const rightArrow = tabBar.querySelector(".tab-scroll-arrow.right");
    const scrollRegion = tabBar.querySelector(".tab-scroll-region");
    const newBtn = tabBar.querySelector(".tab-new");

    expect(leftArrow, "left scroll arrow should exist").toBeTruthy();
    expect(rightArrow, "right scroll arrow should exist").toBeTruthy();
    expect(scrollRegion, "scroll region should exist").toBeTruthy();
    expect(newBtn, "new tab button should exist").toBeTruthy();

    // Tab buttons live inside the scroll region
    const tabsInRegion = scrollRegion!.querySelectorAll(".tab");
    expect(tabsInRegion.length).toBe(1);

    // Structural order: left arrow, scroll region, right arrow, new button
    const children = Array.from(tabBar.children);
    expect(children.indexOf(leftArrow!)).toBeLessThan(children.indexOf(scrollRegion!));
    expect(children.indexOf(scrollRegion!)).toBeLessThan(children.indexOf(rightArrow!));
    expect(children.indexOf(rightArrow!)).toBeLessThan(children.indexOf(newBtn!));
  });

  it("scroll arrows are hidden when all tabs fit (no overflow)", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const leftArrow = h.tabBar.querySelector(".tab-scroll-arrow.left");
    const rightArrow = h.tabBar.querySelector(".tab-scroll-arrow.right");

    // In jsdom, scrollWidth === clientWidth (no real layout), so arrows should be hidden
    expect(leftArrow!.classList.contains("visible")).toBe(false);
    expect(rightArrow!.classList.contains("visible")).toBe(false);
  });
});

describe("reopenLastClosedTab (⌘⇧T)", () => {
  it("is a no-op when the closed-tab stack is empty", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    await h.tabs.createTab(); // need at least one tab so the harness is sane

    const tabsBefore = h.tabs.getTabCount();
    await h.tabs.reopenLastClosedTab();

    expect(h.tabs.getTabCount()).toBe(tabsBefore); // no tab created
    expect(closedTabs.closedTabsCount()).toBe(0);  // stack still empty
  });

  it("reopens a single-leaf tab so a new tab appears", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    // Create two tabs, then close the first.
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab(); // active

    // Close tab A. Snapshot pushes a leaf shape onto the closed-tab stack.
    await h.tabs.closeTab(tabA.id);
    expect(closedTabs.closedTabsCount()).toBe(1);

    const tabsBeforeReopen = h.tabs.getTabCount();
    await h.tabs.reopenLastClosedTab();

    expect(h.tabs.getTabCount()).toBe(tabsBeforeReopen + 1);
    expect(closedTabs.closedTabsCount()).toBe(0); // stack popped
  });

  it("reopens a vertical-split tab and replays the split", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    await h.panes.splitActive("vertical"); // tabA now has two panes

    // Need a sibling tab so closeTab is willing to fire.
    const tabB = await h.tabs.createTab();

    // Switch back to A so we close the split tab.
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    expect(closedTabs.closedTabsCount()).toBe(1);

    await h.tabs.reopenLastClosedTab();

    // After reopen, the active tab should have TWO .pane elements
    // (the replayed split). Use the active container to scope the query.
    const active = h.tabs.getActiveTab();
    expect(active).toBeDefined();
    const paneCount = active!.container.querySelectorAll(".pane").length;
    expect(paneCount).toBe(2);
  });

  it("reopens a nested split (V containing H) with the correct topology", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    await h.panes.splitActive("vertical");   // tabA: V split, 2 leaves
    await h.panes.splitActive("horizontal"); // active leaf becomes H split, 3 leaves total
    expect(h.terminalArea.querySelectorAll(".pane").length).toBe(3);

    // Need a sibling tab so closeTab is willing to fire.
    await h.tabs.createTab();
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    await h.tabs.reopenLastClosedTab();

    const active = h.tabs.getActiveTab();
    expect(active).toBeDefined();
    expect(active!.container.querySelectorAll(".pane").length).toBe(3);
  });

  it("re-entrancy: two concurrent calls only execute one reopen", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    // Push two entries directly, no real closes needed.
    const tabA = await h.tabs.createTab();
    const tabB = await h.tabs.createTab();
    await h.tabs.closeTab(tabA.id);
    expect(closedTabs.closedTabsCount()).toBe(1);

    // Push a second entry by closing tabB after creating a third.
    const tabC = await h.tabs.createTab();
    await h.tabs.closeTab(tabB.id);
    expect(closedTabs.closedTabsCount()).toBe(2);

    // Fire two reopens concurrently. The second should bail on the
    // re-entrancy guard.
    const p1 = h.tabs.reopenLastClosedTab();
    const p2 = h.tabs.reopenLastClosedTab();
    await Promise.all([p1, p2]);

    // Only one entry should have been popped. (The first call pops one;
    // the second call sees `reopening=true` and returns immediately
    // before even calling popClosedTab.)
    expect(closedTabs.closedTabsCount()).toBe(1);
  });

  it("reopens at the saved cwd, not the active tab's cwd", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    // Mutate session.cwd to a known value so shapeFromTree captures it.
    const sessionA = h.sessions[h.sessions.length - 1];
    sessionA.cwd = "/saved/path";

    const tabB = await h.tabs.createTab();
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    // Spy on createTerminalSession to verify it's called with the saved cwd.
    const terminal = await import("./terminal");
    const createTerminalSessionSpy = vi.spyOn(terminal, "createTerminalSession");

    await h.tabs.reopenLastClosedTab();

    // The fix ensures that the saved cwd is passed through to createTerminalSession.
    // Third arg (restoredScrollback) is undefined here — the test stub session has
    // no serialize() method, so shapeFromTree's catch swallows the throw and stores
    // scrollback=undefined. The per-task tests in Task 7 cover the scrollback
    // contract specifically; here we only care about the cwd plumbing.
    // Fifth arg is `command`, the argv a pane can be opened on (used when a
    // Claude session branches or forks). Always undefined on the reopen path —
    // a restored tab gets an ordinary shell — but toHaveBeenCalledWith matches
    // arity exactly, so it has to be named.
    expect(createTerminalSessionSpy).toHaveBeenCalledWith(
      expect.anything(),
      "/saved/path",
      undefined,
      undefined,
      undefined,
    );
  });

  it("captures scrollback at close and replays it via createTerminalSession's third arg", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    const sessionA = h.sessions[h.sessions.length - 1];
    sessionA.serialize = vi.fn().mockReturnValue("captured-output");

    // Need a sibling so closeTab is willing to fire (single-tab close
    // routes to quit instead, which doesn't push to the stack).
    await h.tabs.createTab();
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    // Clear the spy so we count only the reopen's createTerminalSession call.
    (h.terminal as any).createTerminalSession.mockClear();

    await h.tabs.reopenLastClosedTab();

    // The reopened tab's createTerminalSession should have been called with
    // restoredScrollback === "captured-output" (the third positional arg).
    const calls = (h.terminal as any).createTerminalSession.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const lastCall = calls[calls.length - 1];
    expect(lastCall[2]).toBe("captured-output");
  });

  it("replays scrollback for each leaf in a split-tab restoration", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    // First leaf gets a known serialize.
    const leafLeft = h.sessions[h.sessions.length - 1];
    leafLeft.serialize = vi.fn().mockReturnValue("leaf-LEFT");

    await h.panes.splitActive("vertical"); // creates the right leaf
    const leafRight = h.sessions[h.sessions.length - 1];
    leafRight.serialize = vi.fn().mockReturnValue("leaf-RIGHT");

    // Sibling tab so closeTab is willing.
    await h.tabs.createTab();
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    (h.terminal as any).createTerminalSession.mockClear();

    await h.tabs.reopenLastClosedTab();

    // Two new leaves should have been created with the two distinct
    // scrollbacks. We check both calls were made with the right scrollback.
    const calls = (h.terminal as any).createTerminalSession.mock.calls;
    const scrollbacksPassed = calls.map((c: any[]) => c[2]).filter(Boolean);
    expect(scrollbacksPassed).toContain("leaf-LEFT");
    expect(scrollbacksPassed).toContain("leaf-RIGHT");
  });

  it("empty scrollback: createTerminalSession is called with restoredScrollback === undefined", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    // Default `serialize` returns "" — shapeFromTree should normalize to undefined.

    await h.tabs.createTab();
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    (h.terminal as any).createTerminalSession.mockClear();

    await h.tabs.reopenLastClosedTab();

    // The reopen call to createTerminalSession should have its third arg
    // as undefined — proving the normalization "" → undefined runs end-to-end.
    const reopenCall = (h.terminal as any).createTerminalSession.mock.calls[0];
    expect(reopenCall[2]).toBeUndefined();
  });

  it("threads claudeResume from probe through to createTerminalSession on reopen (single-leaf)", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    const sessionA = h.sessions[h.sessions.length - 1];
    sessionA.serialize = vi.fn().mockReturnValue("scrollback-A");

    // Make the probe report a uuid for tabA's pty.
    (h.probe.probeClaudeSession as any).mockImplementation(async (ptyId: number) =>
      ptyId === sessionA.ptyId
        ? { uuid: "d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d" }
        : null,
    );

    await h.tabs.createTab(); // sibling
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    (h.terminal as any).createTerminalSession.mockClear();

    await h.tabs.reopenLastClosedTab();

    const calls = (h.terminal as any).createTerminalSession.mock.calls;
    const reopenCall = calls[calls.length - 1];
    expect(reopenCall[2]).toBe("scrollback-A"); // restoredScrollback
    expect(reopenCall[3]).toEqual({
      uuid: "d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d",
    }); // restoredClaudeResume
  });

  it("attributes claudeResume per-leaf for a split-tab reopen (no cross-pane bleed)", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();

    const tabA = await h.tabs.createTab();
    const leafLeft = h.sessions[h.sessions.length - 1];
    leafLeft.serialize = vi.fn().mockReturnValue("LEFT-out");

    await h.panes.splitActive("vertical");
    const leafRight = h.sessions[h.sessions.length - 1];
    leafRight.serialize = vi.fn().mockReturnValue("RIGHT-out");

    // LEFT pane has claude (uuid-L), RIGHT pane does not.
    (h.probe.probeClaudeSession as any).mockImplementation(async (ptyId: number) => {
      if (ptyId === leafLeft.ptyId) return { uuid: "leftleftleft-leftleft-leftleft-leftLefT0" };
      return null;
    });

    await h.tabs.createTab(); // sibling
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    (h.terminal as any).createTerminalSession.mockClear();

    await h.tabs.reopenLastClosedTab();

    const calls = (h.terminal as any).createTerminalSession.mock.calls;
    // Find the call whose 3rd arg is "LEFT-out" and assert its 4th arg has the uuid.
    const leftCall = calls.find((c: any[]) => c[2] === "LEFT-out");
    const rightCall = calls.find((c: any[]) => c[2] === "RIGHT-out");
    expect(leftCall, "left-leaf reopen call must exist").toBeDefined();
    expect(rightCall, "right-leaf reopen call must exist").toBeDefined();
    expect(leftCall![3]).toEqual({
      uuid: "leftleftleft-leftleft-leftleft-leftLefT0",
    });
    expect(rightCall![3]).toBeUndefined();
  });

  it("when probe returns null, restoredClaudeResume is undefined (reopen unchanged)", async () => {
    const h = await mount();
    const closedTabs = await import("./closed-tabs");
    closedTabs.clearClosedTabs();
    (h.probe.probeClaudeSession as any).mockResolvedValue(null);

    const tabA = await h.tabs.createTab();
    h.sessions[h.sessions.length - 1].serialize = vi.fn().mockReturnValue("plain");

    await h.tabs.createTab(); // sibling
    h.tabs.switchTab(tabA.id);
    await h.tabs.closeTab(tabA.id);

    (h.terminal as any).createTerminalSession.mockClear();

    await h.tabs.reopenLastClosedTab();

    const reopenCall = (h.terminal as any).createTerminalSession.mock.calls[0];
    expect(reopenCall[3]).toBeUndefined();
  });
});

describe("tabDisplayName display priority", () => {
  it("display priority is userName > titleOverride > name", async () => {
    const { tabDisplayName } = await import("./tabs");
    expect(tabDisplayName({ name: "a", titleOverride: "b", userName: "c" })).toBe("c");
    expect(tabDisplayName({ name: "a", titleOverride: "b" })).toBe("b");
    expect(tabDisplayName({ name: "a" })).toBe("a");
  });
});

describe("tab badge", () => {
  it("perm overrides stop", async () => {
    const h = await mount();
    h.tabs.setTabBadge(99, "stop");
    h.tabs.setTabBadge(99, "perm");
    expect(h.tabs.getTabBadge(99)).toBe("perm");
  });

  it("stop does not override perm", async () => {
    const h = await mount();
    h.tabs.setTabBadge(98, "perm");
    h.tabs.setTabBadge(98, "stop");
    expect(h.tabs.getTabBadge(98)).toBe("perm");
  });

  it("null clears the badge", async () => {
    const h = await mount();
    h.tabs.setTabBadge(97, "stop");
    h.tabs.setTabBadge(97, null);
    expect(h.tabs.getTabBadge(97)).toBeNull();
  });

  it("bell badge does not override perm", async () => {
    const h = await mount();
    h.tabs.setTabBadge(1, "perm");
    h.tabs.setTabBadge(1, "bell");
    expect(h.tabs.getTabBadge(1)).toBe("perm");
  });

  it("bell badge is set and cleared", async () => {
    const h = await mount();
    h.tabs.setTabBadge(2, "bell");
    expect(h.tabs.getTabBadge(2)).toBe("bell");
    h.tabs.setTabBadge(2, null);
    expect(h.tabs.getTabBadge(2)).toBe(null);
  });

  it("bell badge does not override stop", async () => {
    const h = await mount();
    h.tabs.setTabBadge(3, "stop");
    h.tabs.setTabBadge(3, "bell");
    expect(h.tabs.getTabBadge(3)).toBe("stop");
  });
});

describe("high-frequency title updates (codex title spinner)", () => {
  // Regression: codex animates a braille spinner in the terminal title —
  // ~10 OSC 0 updates per second for as long as it works. Each update used
  // to go through a full renderTabBar() innerHTML rebuild, so the tab under
  // the cursor was destroyed/recreated 10x/sec: hover transitions restarted
  // forever (visible flicker) and mousedown/mouseup pairs straddled a
  // rebuild (clicks never fired). A title change must patch the existing
  // button in place.
  it("setTabTitle patches the existing tab button in place (same DOM node)", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.tabs.createTab();

    const before = h.tabBar.querySelector<HTMLElement>('[data-tab-id="1"]');
    expect(before).not.toBeNull();

    h.tabs.setTabTitle(1, "⠋ codex");
    const after = h.tabBar.querySelector<HTMLElement>('[data-tab-id="1"]');

    expect(after).toBe(before);
    expect(after!.querySelector(".tab-label")!.textContent).toBe("⠋ codex");
    expect(after!.title).toBe("⠋ codex");
  });

  it("a repeated identical title is a no-op (label text node untouched)", async () => {
    const h = await mount();
    await h.tabs.createTab();

    h.tabs.setTabTitle(1, "⠋ codex");
    const label = h.tabBar.querySelector('[data-tab-id="1"] .tab-label')!;
    const textNode = label.firstChild;

    h.tabs.setTabTitle(1, "⠋ codex");

    const labelAfter = h.tabBar.querySelector('[data-tab-id="1"] .tab-label')!;
    expect(labelAfter).toBe(label);
    expect(labelAfter.firstChild).toBe(textNode);
  });

  it("clearing the title (OSC with empty payload) reverts the label in place", async () => {
    const h = await mount();
    await h.tabs.createTab();

    const autoName = h.tabBar.querySelector('[data-tab-id="1"] .tab-label')!.textContent;
    h.tabs.setTabTitle(1, "⠋ codex");
    const before = h.tabBar.querySelector<HTMLElement>('[data-tab-id="1"]');

    h.tabs.setTabTitle(1, null);
    const after = h.tabBar.querySelector<HTMLElement>('[data-tab-id="1"]');

    expect(after).toBe(before);
    expect(after!.querySelector(".tab-label")!.textContent).toBe(autoName);
  });

  it("a title update while the rename input is open does not clobber the input", async () => {
    const h = await mount();
    await h.tabs.createTab();

    h.tabs.beginRenameTab(1);
    const input = h.tabBar.querySelector<HTMLInputElement>(".tab-rename-input");
    expect(input).not.toBeNull();
    input!.value = "my name";

    h.tabs.setTabTitle(1, "⠙ codex");

    const inputAfter = h.tabBar.querySelector<HTMLInputElement>(".tab-rename-input");
    expect(inputAfter).toBe(input);
    expect(inputAfter!.value).toBe("my name");
  });
});

describe("tab activity dot", () => {
  it("enumerates every pty across every tab, not just the active one", async () => {
    // Background tabs are the whole point: they are the ones the HUD poll
    // skips, so an indicator has to see them.
    const h = await mount();
    await h.tabs.createTab();
    await h.tabs.createTab();

    const refs = h.tabs.allTabPtys();
    expect(refs.length).toBeGreaterThanOrEqual(2);
    const activeId = h.tabs.getActiveTab()!.id;
    expect(refs.some((r) => r.tabId !== activeId)).toBe(true);
    for (const r of refs) expect(typeof r.ptyId).toBe("number");
  });

  it("collects every pty in a split tab, not just the active pane", async () => {
    const h = await mount();
    await h.tabs.createTab();
    await h.panes.splitActive("vertical");

    const tabId = h.tabs.getActiveTab()!.id;
    const refs = h.tabs.allTabPtys().filter((r) => r.tabId === tabId);
    expect(refs.length).toBe(2);
  });

  it("publishes the activity as a data attribute on the tab", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const tabId = h.tabs.getActiveTab()!.id;

    h.tabs.setTabActivity(tabId, { activity: "busy", reason: null });

    const el = h.tabBar.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)!;
    expect(el.dataset.activity).toBe("busy");
    expect(el.querySelector(".tab-activity")).not.toBeNull();
  });

  it("drops the attribute entirely for none, so no dot renders", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const tabId = h.tabs.getActiveTab()!.id;

    h.tabs.setTabActivity(tabId, { activity: "busy", reason: null });
    h.tabs.setTabActivity(tabId, { activity: "none", reason: null });

    const el = h.tabBar.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)!;
    expect(el.dataset.activity).toBeUndefined();
  });

  it("appends the reason to the tooltip without an em dash", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const tabId = h.tabs.getActiveTab()!.id;

    h.tabs.setTabActivity(tabId, { activity: "waiting", reason: "needs permission" });

    const el = h.tabBar.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)!;
    expect(el.title).toContain("needs permission");
    expect(el.title).not.toContain("—");
  });

  it("truncates a very long reason instead of putting it verbatim into the native tooltip", async () => {
    // `reason` is Claude Code's own `detail`/`waiting_for` text, read off
    // disk, not authored by this app — nothing bounds its length or line
    // count on the way in.
    const h = await mount();
    await h.tabs.createTab();
    const tabId = h.tabs.getActiveTab()!.id;
    const longReason = "x".repeat(500);

    h.tabs.setTabActivity(tabId, { activity: "waiting", reason: longReason });

    const el = h.tabBar.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)!;
    // displayName + " (" + up-to-120-char reason + ")".
    const displayName = h.tabs.getActiveTab()!.name;
    expect(el.title.length).toBeLessThanOrEqual(displayName.length + 4 + 120);
    expect(el.title).not.toContain(longReason);
  });

  it("skips all work when the activity is unchanged", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const tabId = h.tabs.getActiveTab()!.id;
    const titleBar = await import("./title-bar");

    h.tabs.setTabActivity(tabId, { activity: "busy", reason: null });
    (titleBar.renderTitle as any).mockClear();
    h.tabs.setTabActivity(tabId, { activity: "busy", reason: null });

    expect(titleBar.renderTitle as any).not.toHaveBeenCalled();
  });

  it("patches the button in place instead of rebuilding the bar", async () => {
    // This runs every 2s per tab. A full renderTabBar() would cancel drags,
    // re-scroll the bar and re-render the title bar on every tick, and would
    // destroy the button under the cursor — the same hazard setTabTitle
    // avoids. renderTitle is the discriminator: renderTabBar calls it,
    // setTabActivity does not.
    const h = await mount();
    await h.tabs.createTab();
    const tabId = h.tabs.getActiveTab()!.id;
    const titleBar = await import("./title-bar");

    h.tabs.setTabActivity(tabId, { activity: "busy", reason: null });
    const el = h.tabBar.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)!;
    (titleBar.renderTitle as any).mockClear();

    // A genuinely different activity, so the early-return does not fire and
    // the patch branch is actually exercised.
    h.tabs.setTabActivity(tabId, { activity: "waiting", reason: "needs permission" });

    expect(titleBar.renderTitle as any).not.toHaveBeenCalled();
    expect(h.tabBar.querySelector(`[data-tab-id="${tabId}"]`)).toBe(el);
    expect(el.dataset.activity).toBe("waiting");
  });

  it("forgets a closed tab's activity", async () => {
    const h = await mount();
    const a = await h.tabs.createTab();
    await h.tabs.createTab();

    h.tabs.setTabActivity(a.id, { activity: "busy", reason: null });
    h.tabs.setTabBadge(a.id, "stop");
    await h.tabs.closeTab(a.id);

    expect(h.tabs.getTabActivity(a.id)).toEqual({ activity: "none", reason: null });
    expect(h.tabs.getTabBadge(a.id)).toBeNull();
  });
});

describe("truncateReason", () => {
  it("leaves a reason at or under the limit untouched", async () => {
    const h = await mount();
    expect(h.tabs.truncateReason("needs permission")).toBe("needs permission");
    expect(h.tabs.truncateReason("x".repeat(120))).toBe("x".repeat(120));
  });

  it("truncates a reason over the limit to at most 120 characters", async () => {
    const h = await mount();
    const got = h.tabs.truncateReason("x".repeat(500));
    expect(got.length).toBe(120);
    expect(got.endsWith("…")).toBe(true);
  });
});

describe("stripActivityGlyph", () => {
  it("strips each of Claude Code's three title glyphs", async () => {
    const h = await mount();
    // The animating pair and the static prefix, from Claude Code's source.
    expect(h.tabs.stripActivityGlyph("◐ my-project")).toBe("my-project");
    expect(h.tabs.stripActivityGlyph("◑ my-project")).toBe("my-project");
    expect(h.tabs.stripActivityGlyph("✳ my-project")).toBe("my-project");
  });

  it("leaves every other title untouched", async () => {
    const h = await mount();
    expect(h.tabs.stripActivityGlyph("my-project")).toBe("my-project");
    // No trailing space: not the prefix pattern.
    expect(h.tabs.stripActivityGlyph("◐my-project")).toBe("◐my-project");
    // Mid-string: not at position zero.
    expect(h.tabs.stripActivityGlyph("build ◐ running")).toBe("build ◐ running");
    // A different glyph entirely, e.g. another TUI's spinner.
    expect(h.tabs.stripActivityGlyph("⠋ my-project")).toBe("⠋ my-project");
    expect(h.tabs.stripActivityGlyph("")).toBe("");
    expect(h.tabs.stripActivityGlyph("◐ ")).toBe("");
  });

  it("shows the stripped title in the tab label", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const sessionId = h.panes.getActiveSession()!.id;

    h.tabs.setTabTitle(sessionId, "◐ my-project");

    const tabId = h.tabs.getActiveTab()!.id;
    const label = h.tabBar.querySelector<HTMLElement>(
      `[data-tab-id="${tabId}"] .tab-label`,
    )!;
    expect(label.textContent).toBe("my-project");
    expect(h.tabs.getActiveTab()!.titleOverride).toBe("my-project");
  });

  it("treats a glyph-only title change as no change at all", async () => {
    // The point of the strip: at roughly one title write per second per busy
    // tab, the old behaviour repainted the label and re-measured the bar's
    // overflow every time. After stripping, the two titles are equal and
    // setTabTitle's existing early-return fires — so updateTabButtonInPlace,
    // and therefore renderTitle, never runs. Element identity cannot show
    // this: renderTabBar reuses cached elements, so identity survives a
    // rebuild too.
    const h = await mount();
    await h.tabs.createTab();
    const sessionId = h.panes.getActiveSession()!.id;
    const titleBar = await import("./title-bar");

    h.tabs.setTabTitle(sessionId, "◐ my-project");
    (titleBar.renderTitle as any).mockClear();

    h.tabs.setTabTitle(sessionId, "◑ my-project");

    expect(titleBar.renderTitle as any).not.toHaveBeenCalled();
    expect(h.tabs.getActiveTab()!.titleOverride).toBe("my-project");
  });

  it("reverts to the default name when the title is nothing but a glyph", async () => {
    const h = await mount();
    await h.tabs.createTab();
    const sessionId = h.panes.getActiveSession()!.id;

    h.tabs.setTabTitle(sessionId, "◐ my-project");
    expect(h.tabs.getActiveTab()!.titleOverride).toBe("my-project");

    h.tabs.setTabTitle(sessionId, "✳ ");
    expect(h.tabs.getActiveTab()!.titleOverride).toBeUndefined();
  });
});
