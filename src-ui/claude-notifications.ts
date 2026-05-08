// Routes claude-notify events from the Tauri backend to the right pane and
// decides which UI surfaces to paint (tab badge, pane badge, toast, macOS
// notification).
//
// Pure routing logic lives in `handleNotifyEvent`. Side effects (DOM paints,
// Tauri notification calls) go through the injected `paint` function so the
// router can be unit-tested without a real DOM or Tauri environment.

export interface NotifyEvent {
  session_id: string;
  kind: "stop" | "notification";
  ts: number;
  message: string | null;
}

export interface NotifyPrefs {
  notifyOnStop: boolean;
  notifyOnPermission: boolean;
  notifySoundEnabled: boolean;
}

export interface PaintRequest {
  kind: "stop" | "notification";
  paneId: number;
  tabId: number;
  message: string | null;
  fireMacOsNotification: boolean;
  playSound: boolean;
}

export interface Routing {
  paneForSession(sessionId: string): number | null;
  tabForPane(paneId: number): number | null;
  activeTabId(): number;
  activePaneId(): number;
  windowFocused(): boolean;
  prefs(): NotifyPrefs;
  paint(req: PaintRequest): void;
}

const COALESCE_WINDOW_MS = 500;
const lastNotificationByTs = new Map<string, number>();

let routing: Routing | null = null;

export function setRoutingForTesting(r: Routing): void {
  routing = r;
  lastNotificationByTs.clear();
}

export function handleNotifyEvent(ev: NotifyEvent): void {
  if (!routing) return;

  const paneId = routing.paneForSession(ev.session_id);
  if (paneId == null) return;
  const tabId = routing.tabForPane(paneId);
  if (tabId == null) return;

  const prefs = routing.prefs();
  const enabled = ev.kind === "stop" ? prefs.notifyOnStop : prefs.notifyOnPermission;
  if (!enabled) return;

  // Coalesce: drop a `stop` that arrives within COALESCE_WINDOW_MS after a
  // `notification` for the same session — common when the user denies
  // permission and Claude immediately bails the turn.
  if (ev.kind === "stop") {
    const lastNotifTs = lastNotificationByTs.get(ev.session_id);
    if (lastNotifTs != null && ev.ts - lastNotifTs < COALESCE_WINDOW_MS) {
      return;
    }
  } else {
    lastNotificationByTs.set(ev.session_id, ev.ts);
  }

  routing.paint({
    kind: ev.kind,
    paneId,
    tabId,
    message: ev.message,
    fireMacOsNotification: !routing.windowFocused(),
    playSound: prefs.notifySoundEnabled && !routing.windowFocused(),
  });
}
