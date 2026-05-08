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
      activeTabId: () => 1,
      activePaneId: () => 0,
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
    handleNotifyEvent(ev({ kind: "notification" }));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("fires macOS notification when window is unfocused", () => {
    routing.windowFocused = () => false;
    handleNotifyEvent(ev({ kind: "notification" }));
    expect(onPaint).toHaveBeenCalledWith(
      expect.objectContaining({ fireMacOsNotification: true }),
    );
  });

  it("coalesces a stop arriving within 500ms of a notification for same session", () => {
    handleNotifyEvent(ev({ kind: "notification", ts: 1000 }));
    onPaint.mockClear();
    handleNotifyEvent(ev({ kind: "stop", ts: 1100 }));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("does NOT coalesce when stop arrives >500ms after notification", () => {
    handleNotifyEvent(ev({ kind: "notification", ts: 1000 }));
    onPaint.mockClear();
    handleNotifyEvent(ev({ kind: "stop", ts: 1600 }));
    expect(onPaint).toHaveBeenCalled();
  });
});
