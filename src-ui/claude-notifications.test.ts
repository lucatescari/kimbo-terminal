import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  handleNotifyEvent,
  setRoutingForTesting,
  type NotifyEvent,
  type PaintRequest,
  type Routing,
} from "./claude-notifications";

function ev(overrides: Partial<NotifyEvent> = {}): NotifyEvent {
  return {
    session_id: "sess-1",
    kind: "stop",
    ts: Date.now(),
    message: null,
    ...overrides,
  };
}

describe("claude-notifications: routing", () => {
  let routing: Routing;
  let onPaint: ReturnType<typeof vi.fn<(req: PaintRequest) => void>>;

  beforeEach(() => {
    onPaint = vi.fn<(req: PaintRequest) => void>();
    routing = {
      paneForSession: (id) => (id === "sess-1" ? 7 : null),
      tabForPane: (paneId) => (paneId === 7 ? 3 : null),
      tabName: () => "test-tab",
      cwdBasename: () => "test-dir",
      windowFocused: () => true,
      prefs: () => ({ notifyOnStop: true, notifyOnPermission: true, notifySoundEnabled: false }),
      paint: onPaint,
    };
    setRoutingForTesting(routing);
  });

  it("drops events for unknown sessions", () => {
    handleNotifyEvent(ev({ session_id: "unknown" }));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("paints when stop arrives for a known session", () => {
    handleNotifyEvent(ev({ kind: "stop" }));
    expect(onPaint).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "stop", paneId: 7, tabId: 3, fireMacOsNotification: false }),
    );
  });

  it("respects notifyOnStop=false (drops stop)", () => {
    routing.prefs = () => ({ notifyOnStop: false, notifyOnPermission: true, notifySoundEnabled: false });
    handleNotifyEvent(ev({ kind: "stop" }));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("respects notifyOnPermission=false (drops notification)", () => {
    routing.prefs = () => ({ notifyOnStop: true, notifyOnPermission: false, notifySoundEnabled: false });
    handleNotifyEvent(
      ev({ kind: "notification", message: "Claude needs your permission to use Bash" }),
    );
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("fires macOS notification when window is unfocused", () => {
    routing.windowFocused = () => false;
    handleNotifyEvent(
      ev({ kind: "notification", message: "Claude needs your permission to use Bash" }),
    );
    expect(onPaint).toHaveBeenCalledWith(
      expect.objectContaining({ fireMacOsNotification: true }),
    );
  });

  it("coalesces a stop arriving within 500ms of a notification for same session", () => {
    handleNotifyEvent(
      ev({ kind: "notification", ts: 1000, message: "Claude needs your permission to use Bash" }),
    );
    onPaint.mockClear();
    handleNotifyEvent(ev({ kind: "stop", ts: 1100 }));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("does NOT coalesce when stop arrives >500ms after notification", () => {
    handleNotifyEvent(
      ev({ kind: "notification", ts: 1000, message: "Claude needs your permission to use Bash" }),
    );
    onPaint.mockClear();
    handleNotifyEvent(ev({ kind: "stop", ts: 1600 }));
    expect(onPaint).toHaveBeenCalled();
  });
});

// Claude Code's `Notification` hook fires for TWO subtypes (per the
// claude-pane-notifications spec, line 35):
//   1. "Claude needs your permission to use <Tool>" — actual permission request
//   2. "Claude is waiting for your input"            — 60s prompt-idle ping
// Without distinguishing them, idle pings get painted as "Claude needs
// permission" toasts/macOS notifications. With --dangerously-skip-permissions
// only (2) fires, so the user only ever sees mislabeled idle pings.
describe("claude-notifications: notification subtype (permission vs idle)", () => {
  let routing: Routing;
  let onPaint: ReturnType<typeof vi.fn<(req: PaintRequest) => void>>;

  beforeEach(() => {
    onPaint = vi.fn<(req: PaintRequest) => void>();
    routing = {
      paneForSession: (id) => (id === "sess-1" ? 7 : null),
      tabForPane: (paneId) => (paneId === 7 ? 3 : null),
      tabName: () => "test-tab",
      cwdBasename: () => "test-dir",
      windowFocused: () => true,
      prefs: () => ({ notifyOnStop: true, notifyOnPermission: true, notifySoundEnabled: false }),
      paint: onPaint,
    };
    setRoutingForTesting(routing);
  });

  it("paints when message is a real permission request", () => {
    handleNotifyEvent(
      ev({ kind: "notification", message: "Claude needs your permission to use Bash" }),
    );
    expect(onPaint).toHaveBeenCalledTimes(1);
  });

  it("drops the 60s prompt-idle ping (message: 'Claude is waiting for your input')", () => {
    handleNotifyEvent(
      ev({ kind: "notification", message: "Claude is waiting for your input" }),
    );
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("drops a notification with a null message (cannot confirm it's a permission ask)", () => {
    handleNotifyEvent(ev({ kind: "notification", message: null }));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("idle ping does NOT poison the stop-coalesce window for a later stop", () => {
    // An idle ping at t=1000 is dropped — a stop arriving 100ms later must
    // still paint. (If we accidentally recorded the idle in the coalesce map,
    // the stop would be swallowed.)
    handleNotifyEvent(
      ev({ kind: "notification", ts: 1000, message: "Claude is waiting for your input" }),
    );
    handleNotifyEvent(ev({ kind: "stop", ts: 1100 }));
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(onPaint).toHaveBeenCalledWith(expect.objectContaining({ kind: "stop" }));
  });
});

// Regression: lastNotificationByTs was a Map<string, number> that NEVER got
// pruned. Every notification event from a unique Claude session added an entry
// that persisted for the lifetime of the app. Over hours with many Claude Code
// instances this grew unboundedly. The fix adds a pruneNotificationMap()
// function that caps the map at MAX_NOTIFICATION_ENTRIES (500) and drops old
// entries when exceeded.
describe("claude-notifications: notification timestamp map bounded growth", () => {
  let routing: Routing;
  let onPaint: ReturnType<typeof vi.fn<(req: PaintRequest) => void>>;

  beforeEach(() => {
    onPaint = vi.fn<(req: PaintRequest) => void>();
    routing = {
      paneForSession: () => 7,
      tabForPane: () => 3,
      tabName: () => "test-tab",
      cwdBasename: () => "test-dir",
      windowFocused: () => true,
      prefs: () => ({ notifyOnStop: true, notifyOnPermission: true, notifySoundEnabled: false }),
      paint: onPaint,
    };
    setRoutingForTesting(routing);
  });

  it("still coalesces correctly after 600 unique sessions (pruning preserves recent entries)", () => {
    const baseTs = 1_000_000;

    // Fire 600 notification events from unique sessions. Without pruning,
    // the map grows to 600 entries; with pruning, it's capped at 500.
    for (let i = 0; i < 600; i++) {
      handleNotifyEvent(
        ev({
          session_id: `sess-${i}`,
          kind: "notification",
          ts: baseTs + i,
          message: "Claude needs your permission to use Bash",
        }),
      );
    }
    expect(onPaint).toHaveBeenCalledTimes(600);

    onPaint.mockClear();

    // A stop for the MOST RECENT session should be coalesced (suppressed)
    // because its timestamp entry survived pruning (recent entries are kept).
    handleNotifyEvent(
      ev({ session_id: "sess-599", kind: "stop", ts: baseTs + 599 }),
    );
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("old session entries are pruned (stop for old session is not coalesced)", () => {
    const baseTs = 1_000_000;

    for (let i = 0; i < 600; i++) {
      handleNotifyEvent(
        ev({
          session_id: `sess-prune-${i}`,
          kind: "notification",
          ts: baseTs + i,
          message: "Claude needs your permission to use Bash",
        }),
      );
    }
    onPaint.mockClear();

    // A stop for the OLDEST session should NOT be coalesced — its timestamp
    // entry was dropped by pruning. Pre-fix, this would have been coalesced
    // because the map retained all entries forever.
    handleNotifyEvent(
      ev({ session_id: "sess-prune-0", kind: "stop", ts: baseTs + 1 }),
    );
    expect(
      onPaint,
      "stop for a pruned session must paint — its coalesce entry was dropped",
    ).toHaveBeenCalledTimes(1);
  });
});
