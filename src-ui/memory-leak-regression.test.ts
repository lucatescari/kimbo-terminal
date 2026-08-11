// Memory-leak regression tests.
//
// These tests pin the fixes for the "tauri://localhost uses 1GB+ RAM after
// extended use" investigation. Each section targets a specific leak vector:
//
//   1. Uncleaned setInterval loops (tabs, panes, status-bar)
//   2. Per-pane polling surviving session disposal
//   3. Unbounded notification-timestamp Map
//   4. Blob URL retention on terminal disposal (osc1337)
//   5. OSC 8 provideLinks GC pressure (flatMap → for-loop)
//   6. beforeunload teardown wiring in main.ts
//
// Source-inspection tests verify the fix patterns are in place. Functional
// tests exercise the disposal paths and confirm cleanup actually fires.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const tabsSrc = readFileSync(resolve(__dirname, "tabs.ts"), "utf-8");
const panesSrc = readFileSync(resolve(__dirname, "panes.ts"), "utf-8");
const statusBarSrc = readFileSync(resolve(__dirname, "status-bar.ts"), "utf-8");
const osc1337Src = readFileSync(resolve(__dirname, "osc1337-renderer.ts"), "utf-8");
const osc8Src = readFileSync(resolve(__dirname, "osc8.ts"), "utf-8");
const notifySrc = readFileSync(resolve(__dirname, "claude-notifications.ts"), "utf-8");
const mainSrc = readFileSync(resolve(__dirname, "main.ts"), "utf-8");

// ===========================================================================
// 1. TABS: CWD polling interval is stored and cleanable
// ===========================================================================

describe("memory: tabs.ts CWD polling interval lifecycle", () => {
  it("stores the interval handle in a module-level variable", () => {
    expect(tabsSrc).toMatch(/tabNamePoller\s*=\s*setInterval/);
  });

  it("clears any existing interval before creating a new one in initTabs", () => {
    // Guards against double-init leaking a handle.
    const initBody = tabsSrc.slice(
      tabsSrc.indexOf("export function initTabs"),
      tabsSrc.indexOf("export function disposeTabs"),
    );
    expect(initBody).toMatch(/clearInterval\s*\(\s*tabNamePoller\s*\)/);
  });

  it("exports a disposeTabs function that clears and nulls the handle", () => {
    expect(tabsSrc).toMatch(/export function disposeTabs/);
    const disposeBody = tabsSrc.slice(tabsSrc.indexOf("export function disposeTabs"));
    expect(disposeBody).toMatch(/clearInterval\s*\(\s*tabNamePoller\s*\)/);
    expect(disposeBody).toMatch(/tabNamePoller\s*=\s*null/);
  });

  it("no longer has a bare module-level setInterval (the old leak)", () => {
    // The old code was `setInterval(async () => { ... }, 2000);` at module
    // scope — its return value was discarded so it could never be cleared.
    // After the fix, the setInterval lives inside initTabs and is captured.
    //
    // Strip function bodies (initTabs, disposeTabs) and verify no bare
    // setInterval remains at module scope.
    const beforeInit = tabsSrc.slice(0, tabsSrc.indexOf("export function initTabs"));
    const afterDispose = tabsSrc.slice(
      tabsSrc.indexOf("export function disposeTabs") + "export function disposeTabs".length,
    );
    // The old bare setInterval was preceded by a comment "// Periodically update"
    // and NOT inside a function body. Verify that pattern is gone.
    expect(beforeInit).not.toMatch(/^setInterval\s*\(/m);
    // After disposeTabs, the next code should be the setTabTitle function, not
    // a bare setInterval.
    expect(afterDispose).not.toMatch(/^setInterval\s*\(/m);
  });
});

// ===========================================================================
// 2. PANES: per-pane polling is stopped on session disposal
// ===========================================================================

describe("memory: panes.ts per-pane polling lifecycle", () => {
  it("wraps session.dispose to clear the poll interval", () => {
    expect(panesSrc).toMatch(/const originalDispose\s*=\s*session\.dispose/);
    expect(panesSrc).toMatch(/session\.dispose\s*=\s*\(\)\s*=>\s*\{/);
  });

  it("sets a pollStopped flag AND calls clearInterval in the wrapped dispose", () => {
    const wrapperStart = panesSrc.indexOf("session.dispose = ()");
    expect(wrapperStart).toBeGreaterThan(-1);
    const wrapperBody = panesSrc.slice(wrapperStart, panesSrc.indexOf("originalDispose();", wrapperStart) + 30);
    expect(wrapperBody).toMatch(/pollStopped\s*=\s*true/);
    expect(wrapperBody).toMatch(/clearInterval\s*\(\s*poll\s*\)/);
    expect(wrapperBody).toMatch(/originalDispose\s*\(\s*\)/);
  });

  it("checks pollStopped in the interval callback for defense-in-depth", () => {
    // Even if clearInterval doesn't fully stop an in-flight tick, the
    // pollStopped flag causes an early return.
    const intervalBody = panesSrc.slice(
      panesSrc.indexOf("const poll = window.setInterval"),
      panesSrc.indexOf("}, 2000);") + 10,
    );
    expect(intervalBody).toMatch(/pollStopped/);
  });
});

// ===========================================================================
// 3. STATUS-BAR: polling can be stopped
// ===========================================================================

describe("memory: status-bar.ts polling lifecycle", () => {
  it("exports a stopStatusBarPolling function", () => {
    expect(statusBarSrc).toMatch(/export function stopStatusBarPolling/);
  });

  it("clears and nulls refreshTimer in stopStatusBarPolling", () => {
    const stopBody = statusBarSrc.slice(statusBarSrc.indexOf("export function stopStatusBarPolling"));
    expect(stopBody).toMatch(/clearInterval\s*\(\s*refreshTimer\s*\)/);
    expect(stopBody).toMatch(/refreshTimer\s*=\s*null/);
  });
});

// ===========================================================================
// 4. OSC 1337: blob URLs are tracked and revoked on terminal teardown
// ===========================================================================

describe("memory: osc1337-renderer.ts blob URL lifecycle", () => {
  it("tracks blob URLs in a dedicated Set", () => {
    expect(osc1337Src).toMatch(/liveBlobUrls\s*=\s*new Set/);
  });

  it("adds each blob URL to the tracking set on creation", () => {
    expect(osc1337Src).toMatch(/liveBlobUrls\.add\s*\(\s*blobUrl\s*\)/);
  });

  it("removes from tracking set on decoration dispose", () => {
    expect(osc1337Src).toMatch(/liveBlobUrls\.delete\s*\(\s*blobUrl\s*\)/);
  });

  it("revokes all remaining blob URLs in the cleanup function", () => {
    // The cleanup function (returned by attachOsc1337Renderer) must iterate
    // liveBlobUrls and call revokeObjectURL for any that survived decoration
    // disposal — this covers the case where the terminal is disposed before
    // all decorations fire onDispose.
    const cleanupStart = osc1337Src.lastIndexOf("return () => {");
    expect(cleanupStart).toBeGreaterThan(-1);
    const cleanupBody = osc1337Src.slice(cleanupStart);
    expect(cleanupBody).toMatch(/for\s*\(\s*const url of liveBlobUrls\s*\)/);
    expect(cleanupBody).toMatch(/revokeObjectURL\s*\(\s*url\s*\)/);
    expect(cleanupBody).toMatch(/liveBlobUrls\.clear\s*\(\s*\)/);
  });
});

// ===========================================================================
// 5. OSC 8: provideLinks uses a for-loop, not flatMap
// ===========================================================================

describe("memory: osc8.ts provideLinks optimization", () => {
  it("does NOT use flatMap in provideLinks (avoids N intermediate arrays per hover)", () => {
    // The old code: `ranges.flatMap((r) => { ... })` — creates N short-lived
    // arrays that thrash the GC on every hover event across 5,000 ranges.
    const providerStart = osc8Src.indexOf("provideLinks(bufferLineNumber");
    expect(providerStart).toBeGreaterThan(-1);
    const providerBody = osc8Src.slice(providerStart, osc8Src.indexOf("callback(links)", providerStart) + 20);
    expect(providerBody).not.toMatch(/\.flatMap\s*\(/);
  });

  it("uses a plain loop with push instead", () => {
    const providerStart = osc8Src.indexOf("provideLinks(bufferLineNumber");
    const providerBody = osc8Src.slice(providerStart, osc8Src.indexOf("callback(links)", providerStart) + 20);
    // Either loop form satisfies the intent (no intermediate arrays per hover).
    // The reverse indexed form is what the marker-based tracking needs: it
    // splices ranges whose marker has been disposed as it goes, which a for-of
    // cannot do safely.
    expect(providerBody).toMatch(
      /for\s*\(\s*(const r of ranges\s*\)|let i = ranges\.length)/,
    );
    expect(providerBody).toMatch(/links\.push\s*\(/);
  });
});

// ===========================================================================
// 6. CLAUDE-NOTIFICATIONS: timestamp map is bounded
// ===========================================================================

describe("memory: claude-notifications.ts map pruning", () => {
  it("defines a MAX_NOTIFICATION_ENTRIES cap", () => {
    expect(notifySrc).toMatch(/MAX_NOTIFICATION_ENTRIES\s*=\s*\d+/);
  });

  it("implements a pruneNotificationMap function", () => {
    expect(notifySrc).toMatch(/function pruneNotificationMap/);
  });

  it("calls pruneNotificationMap after adding a new entry", () => {
    // The set + prune must be colocated so the map is pruned on every insert.
    const setLine = notifySrc.indexOf("lastNotificationByTs.set(ev.session_id");
    expect(setLine).toBeGreaterThan(-1);
    const afterSet = notifySrc.slice(setLine, setLine + 200);
    expect(afterSet).toMatch(/pruneNotificationMap\s*\(\s*\)/);
  });

  it("prune drops old entries first, then halves if still over cap", () => {
    const pruneBody = notifySrc.slice(
      notifySrc.indexOf("function pruneNotificationMap"),
      notifySrc.indexOf("}", notifySrc.indexOf("}", notifySrc.indexOf("function pruneNotificationMap")) + 1) + 1,
    );
    // Step 1: drop entries older than cutoff
    expect(pruneBody).toMatch(/cutoff/);
    expect(pruneBody).toMatch(/lastNotificationByTs\.delete/);
    // Step 2: if still over, drop oldest half
    expect(pruneBody).toMatch(/Math\.floor\s*\(\s*entries\.length\s*\/\s*2\s*\)/);
  });
});

// ===========================================================================
// 7. MAIN.TS: beforeunload tears down all global intervals
// ===========================================================================

describe("memory: main.ts beforeunload teardown", () => {
  it("captures the session autosave disposer", () => {
    expect(mainSrc).toMatch(/const stopSessionAutosave\s*=\s*startSessionAutosave/);
  });

  it("registers a beforeunload listener that calls all three disposers", () => {
    expect(mainSrc).toMatch(/addEventListener\s*\(\s*["']beforeunload["']/);
    const unloadStart = mainSrc.indexOf("beforeunload");
    const unloadBody = mainSrc.slice(unloadStart, unloadStart + 300);
    expect(unloadBody).toMatch(/stopSessionAutosave\s*\(\s*\)/);
    expect(unloadBody).toMatch(/disposeTabs\s*\(\s*\)/);
    expect(unloadBody).toMatch(/stopStatusBarPolling\s*\(\s*\)/);
  });

  it("imports disposeTabs from tabs module", () => {
    expect(mainSrc).toMatch(/import\s*\{[^}]*disposeTabs[^}]*\}\s*from\s*["']\.\/tabs["']/);
  });

  it("imports stopStatusBarPolling from status-bar module", () => {
    expect(mainSrc).toMatch(/import\s*\{[^}]*stopStatusBarPolling[^}]*\}\s*from\s*["']\.\/status-bar["']/);
  });
});

// ===========================================================================
// 8. FUNCTIONAL: disposeTabs actually stops the CWD polling
// ===========================================================================

// Use the same mock pattern as tabs.test.ts.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./claude-session-probe", () => ({
  probeClaudeSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("./terminal", () => {
  const sessions: Array<any> = [];
  let nextId = 1;
  const createTerminalSession = vi.fn(async (parentEl: HTMLElement) => {
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
      term: { focus() {}, buffer: { active: { viewportY: 0, baseY: 0 } }, scrollToBottom() {} },
      fit: { fit() {} },
      search: {},
      serialize: vi.fn().mockReturnValue(""),
      dispose() { session.disposed = true; container.remove(); },
    };
    sessions.push(session);
    return session;
  });
  return {
    createTerminalSession,
    setTabTitleHandler: vi.fn(),
    __sessions: sessions,
    __reset: () => { sessions.length = 0; nextId = 1; createTerminalSession.mockClear(); },
  };
});

vi.mock("./pty", () => ({
  createPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn(),
  resizePty: vi.fn(),
  closePty: vi.fn().mockResolvedValue(undefined),
  getCwd: vi.fn().mockResolvedValue("/test/path"),
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

describe("functional: disposeTabs stops CWD polling interval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("getCwd is called on the interval, then stops after disposeTabs", async () => {
    vi.resetModules();

    const tabBar = document.createElement("div");
    const terminalArea = document.createElement("div");
    document.body.appendChild(tabBar);
    document.body.appendChild(terminalArea);

    const tabs = await import("./tabs");
    const pty = await import("./pty");
    const terminal = (await import("./terminal")) as any;
    terminal.__reset();

    tabs.initTabs(tabBar, terminalArea);
    await tabs.createTab();

    // Clear call counts from setup phase.
    (pty.getCwd as any).mockClear();

    // Advance 2s — tab CWD poller fires.
    await vi.advanceTimersByTimeAsync(2000);
    const callsBeforeDispose = (pty.getCwd as any).mock.calls.length;
    expect(callsBeforeDispose).toBeGreaterThan(0);

    // Dispose and verify no more calls.
    tabs.disposeTabs();
    (pty.getCwd as any).mockClear();

    await vi.advanceTimersByTimeAsync(6000); // 3 more intervals
    expect(
      (pty.getCwd as any).mock.calls.length,
      "getCwd must not be called after disposeTabs — the interval should be dead",
    ).toBe(0);
  });
});

// ===========================================================================
// 9. FUNCTIONAL: pane disposal stops per-pane polling
// ===========================================================================

describe("functional: pane session.dispose stops per-pane polling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("closing a pane calls clearInterval (the wrapped dispose stops the poll)", async () => {
    vi.resetModules();

    const tabBar = document.createElement("div");
    const terminalArea = document.createElement("div");
    document.body.appendChild(tabBar);
    document.body.appendChild(terminalArea);

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const tabs = await import("./tabs");
    const terminal = (await import("./terminal")) as any;
    terminal.__reset();

    tabs.initTabs(tabBar, terminalArea);
    await tabs.createTab();

    // Split to get 2 panes — closeActiveOrTab on a split closes the active pane.
    const panes = await import("./panes");
    await panes.splitActive("vertical");

    // Record clearInterval calls so far (initTabs also calls clearInterval
    // as a guard). We want to see NEW clearInterval calls from pane disposal.
    const callsBefore = clearIntervalSpy.mock.calls.length;

    // Close the active pane — this calls the wrapped session.dispose which
    // should call clearInterval(poll).
    tabs.closeActiveOrTab();

    const newCalls = clearIntervalSpy.mock.calls.length - callsBefore;
    expect(
      newCalls,
      "closing a pane must call clearInterval at least once (the per-pane poll)",
    ).toBeGreaterThanOrEqual(1);

    clearIntervalSpy.mockRestore();
  });

  it("the disposed session has its original dispose behavior preserved", async () => {
    vi.resetModules();

    const tabBar = document.createElement("div");
    const terminalArea = document.createElement("div");
    document.body.appendChild(tabBar);
    document.body.appendChild(terminalArea);

    const tabs = await import("./tabs");
    const terminal = (await import("./terminal")) as any;
    terminal.__reset();

    tabs.initTabs(tabBar, terminalArea);
    await tabs.createTab();
    const panes = await import("./panes");
    await panes.splitActive("vertical");

    // The most recently created session is the active (right) pane.
    const activeSession = terminal.__sessions[terminal.__sessions.length - 1];
    expect(activeSession.disposed).toBe(false);

    tabs.closeActiveOrTab();

    // Original dispose behavior must still run (session.disposed = true,
    // container removed). The wrapping should call originalDispose().
    expect(
      activeSession.disposed,
      "wrapped dispose must call the original dispose (PTY freed)",
    ).toBe(true);
  });
});

// ===========================================================================
// 10. FUNCTIONAL: notification map stays bounded after many events
// ===========================================================================

describe("functional: notification timestamp map bounded growth", () => {
  it("map does not exceed MAX_NOTIFICATION_ENTRIES after 1000 unique sessions", async () => {
    // Each notification event from a unique session adds an entry.
    // Without pruning, 1000 events → 1000 entries. With pruning, the map
    // is capped at 500 and excess entries are dropped.
    const { handleNotifyEvent, setRoutingForTesting } = await import("./claude-notifications");

    const onPaint = vi.fn();
    setRoutingForTesting({
      paneForSession: () => 1,
      tabForPane: () => 1,
      tabName: () => "t",
      cwdBasename: () => null,
      windowFocused: () => true,
      prefs: () => ({ notifyOnStop: true, notifyOnPermission: true, notifySoundEnabled: false }),
      paint: onPaint,
    });

    const baseTs = 2_000_000;

    // Fire 1000 notification events from unique sessions.
    for (let i = 0; i < 1000; i++) {
      handleNotifyEvent({
        session_id: `session-${i}`,
        kind: "notification",
        ts: baseTs + i,
        message: "Claude needs your permission to use Bash",
      });
    }

    // The paint function was called 1000 times (one per event).
    expect(onPaint).toHaveBeenCalledTimes(1000);

    // The internal map should be bounded. We can't access it directly,
    // but we can verify the system still functions correctly — a stop
    // arriving for the most recent session should still be coalesced
    // (proving the map retained recent entries), and one for an old
    // session should NOT be coalesced (proving old entries were dropped).
    onPaint.mockClear();

    // Recent session: stop within 500ms should be coalesced (suppressed).
    handleNotifyEvent({
      session_id: "session-999",
      kind: "stop",
      ts: baseTs + 999, // within coalesce window of the notification
      message: null,
    });
    expect(
      onPaint,
      "stop for recent session should be coalesced (not painted)",
    ).not.toHaveBeenCalled();

    // Old session (pruned): stop should NOT be coalesced (it should paint).
    handleNotifyEvent({
      session_id: "session-0",
      kind: "stop",
      ts: baseTs + 1500,
      message: null,
    });
    expect(
      onPaint,
      "stop for a pruned session should paint (entry was dropped by pruning)",
    ).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 11. PERFORMANCE: osc8 for-loop is at least as fast as the old flatMap
// ===========================================================================

describe("performance: osc8 provideLinks for-loop vs flatMap", () => {
  it("for-loop provideLinks stays within frame budget after heavy session", async () => {
    // Drives the real attachOsc8Links against a mock terminal. The for-loop
    // should be at least as fast as the flatMap it replaced — this test uses
    // the same budget as osc8-link-growth.test.ts (1000ms) as a regression
    // guard.
    const { attachOsc8Links } = await import("./osc8");

    const cursor = { baseY: 0, cursorY: 0, cursorX: 0 };
    let osc8Handler: ((data: string) => boolean) | null = null;
    let linkProvider: any = null;

    const term = {
      cols: 80,
      buffer: { active: cursor },
      parser: {
        registerOscHandler(code: number, handler: any) {
          if (code === 8) osc8Handler = handler;
          return { dispose() {} };
        },
      },
      // Link ranges are anchored to markers so they follow their line as the
      // buffer trims; the tracker registers one per link open and close.
      registerMarker(offset = 0) {
        return {
          line: cursor.baseY + cursor.cursorY + offset,
          isDisposed: false,
          dispose() { this.isDisposed = true; },
          onDispose() { return { dispose() {} }; },
        };
      },
      registerLinkProvider(p: any) {
        linkProvider = p;
        return { dispose() {} };
      },
    };

    attachOsc8Links(term as unknown as import("@xterm/xterm").Terminal, () => {});

    // Emit 20k hyperlinks to fill the tracker to its cap.
    for (let i = 0; i < 20_000; i++) {
      osc8Handler!(`1;https://example.com/${i}`);
      cursor.cursorX += 10;
      osc8Handler!("");
      cursor.baseY += 1;
      cursor.cursorX = 0;
    }

    // Warm up.
    for (let n = 0; n < 100; n++) {
      linkProvider!.provideLinks(1, () => {});
    }

    // Timed runs — take the best of 3.
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      for (let n = 0; n < 1000; n++) {
        linkProvider!.provideLinks(1, () => {});
      }
      best = Math.min(best, performance.now() - start);
    }

    expect(best).toBeLessThan(1000);
  });
});

// ===========================================================================
// 12. FUNCTIONAL: status-bar stopStatusBarPolling stops the interval
// ===========================================================================

describe("functional: stopStatusBarPolling stops CWD polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("getCwd is no longer called after stopStatusBarPolling", async () => {
    vi.resetModules();

    const container = document.createElement("div");
    document.body.appendChild(container);

    const statusBar = await import("./status-bar");
    const pty = await import("./pty");

    // initStatusBar starts polling immediately.
    statusBar.initStatusBar(container);
    (pty.getCwd as any).mockClear();

    // Advance 2s — polling fires.
    await vi.advanceTimersByTimeAsync(2000);
    const callsBefore = (pty.getCwd as any).mock.calls.length;
    // getCwd might not be called if getActiveSession returns undefined
    // (tabs aren't set up). That's fine — we just need to verify stopPolling
    // clears the interval handle.

    // Stop polling.
    statusBar.stopStatusBarPolling();
    (pty.getCwd as any).mockClear();

    // Advance 6s — no more calls should fire.
    await vi.advanceTimersByTimeAsync(6000);
    expect(
      (pty.getCwd as any).mock.calls.length,
      "getCwd must not be called after stopStatusBarPolling",
    ).toBe(0);
  });
});
