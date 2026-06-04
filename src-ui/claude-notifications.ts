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
  tabName: string;
  cwdBasename: string | null;
  message: string | null;
  fireMacOsNotification: boolean;
  playSound: boolean;
}

export interface Routing {
  paneForSession(sessionId: string): number | null;
  tabForPane(paneId: number): number | null;
  tabName(tabId: number): string;
  cwdBasename(paneId: number): string | null;
  windowFocused(): boolean;
  prefs(): NotifyPrefs;
  paint(req: PaintRequest): void;
}

const COALESCE_WINDOW_MS = 500;
/** Cap the timestamp map so it can't grow unboundedly in long sessions. The
 *  map only needs entries young enough for the coalesce window to fire, so
 *  we prune aggressively: when the cap is reached, drop every entry older
 *  than the coalesce window. If everything is recent, halve the map. */
const MAX_NOTIFICATION_ENTRIES = 500;
const lastNotificationByTs = new Map<string, number>();

function pruneNotificationMap(): void {
  if (lastNotificationByTs.size <= MAX_NOTIFICATION_ENTRIES) return;
  const cutoff = Date.now() - COALESCE_WINDOW_MS * 2;
  for (const [key, ts] of lastNotificationByTs) {
    if (ts < cutoff) lastNotificationByTs.delete(key);
  }
  // If still over cap (everything is recent), drop the oldest half.
  if (lastNotificationByTs.size > MAX_NOTIFICATION_ENTRIES) {
    const entries = [...lastNotificationByTs.entries()]
      .sort(([, a], [, b]) => a - b);
    const toDrop = Math.floor(entries.length / 2);
    for (let i = 0; i < toDrop; i++) {
      lastNotificationByTs.delete(entries[i][0]);
    }
  }
}

// Claude Code's `Notification` hook fires for two distinct subtypes (see the
// claude-pane-notifications design spec): real permission requests
// (message: "Claude needs your permission to use <Tool>") and the 60s
// prompt-idle ping (message: "Claude is waiting for your input"). Only the
// first should drive the "Claude needs permission" UI — the idle ping is
// noise after a Stop already told the user Claude finished, and it surfaces
// even when `--dangerously-skip-permissions` is set (which is what made it
// look like spurious permission prompts).
function isPermissionRequest(message: string | null): boolean {
  if (!message) return false;
  return message.toLowerCase().includes("permission");
}

interface PendingFocus {
  tabId: number;
  paneId: number;
  expiresAt: number;
}

const PENDING_FOCUS_TTL_MS = 30_000;
let pendingFocus: PendingFocus | null = null;
let focusListenerInstalled = false;

let routing: Routing | null = null;

export function setRoutingForTesting(r: Routing): void {
  routing = r;
  lastNotificationByTs.clear();
}

function ensureFocusListener(focusPane: (tabId: number, paneId: number) => void): void {
  if (focusListenerInstalled) return;
  focusListenerInstalled = true;
  window.addEventListener("focus", () => {
    if (!pendingFocus) return;
    if (Date.now() > pendingFocus.expiresAt) {
      pendingFocus = null;
      return;
    }
    const target = pendingFocus;
    pendingFocus = null;
    focusPane(target.tabId, target.paneId);
  });
}

// NOTE: The focus-listener path (notification click → window regains focus →
// route to pending pane) is only exercised in wireClaudeNotifications, which
// requires a real Tauri environment. Unit tests do not cover this path.
export function clearPendingFocusForTesting(): void {
  pendingFocus = null;
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

  // Filter non-permission notifications (idle pings, unknown future variants)
  // before they enter the coalesce window — otherwise an idle ping at t+60s
  // would (a) paint a wrong "needs permission" UI and (b) get recorded in
  // lastNotificationByTs, potentially swallowing a legit Stop later.
  if (ev.kind === "notification" && !isPermissionRequest(ev.message)) {
    return;
  }

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
    pruneNotificationMap();
  }

  routing.paint({
    kind: ev.kind,
    paneId,
    tabId,
    tabName: routing.tabName(tabId),
    cwdBasename: routing.cwdBasename(paneId),
    message: ev.message,
    fireMacOsNotification: !routing.windowFocused(),
    playSound: prefs.notifySoundEnabled && !routing.windowFocused(),
  });
}

import { showToast } from "./toast";
import { setTabBadge, switchTab, getActiveTab, findTabIdByPaneId, findTabById } from "./tabs";
import { setPaneBadge, getActivePaneId, setActivePane, paneCwdBasename } from "./panes";
import { paneForSession as paneForSessionLookup } from "./claude-session-map";
import { getPrefs } from "./ui-prefs";

/** Best-effort: ask macOS for notification permission. Called after the
 *  hooks are installed so the prompt comes at a moment the user expects,
 *  not the first time an unfocused notification fires. Idempotent: if
 *  already granted (or already denied), this is a no-op. */
export async function ensureNotificationPermission(): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) return;
    await requestPermission();
  } catch (e) {
    console.warn("ensureNotificationPermission failed:", e);
  }
}

export async function wireClaudeNotifications(): Promise<void> {
  const { listen } = await import("@tauri-apps/api/event");
  const { sendNotification, isPermissionGranted, requestPermission } =
    await import("@tauri-apps/plugin-notification");
  const { resolveResource } = await import("@tauri-apps/api/path");

  // Resolve the bundled kimbo icon once. macOS notifications fall back to a
  // generic terminal icon in dev mode without an explicit icon path because
  // the dev binary isn't a real .app bundle. In prod the bundle's app icon
  // would also work, but passing the path explicitly keeps both paths
  // consistent.
  let notificationIcon: string | undefined;
  try {
    notificationIcon = await resolveResource("icons/128x128.png");
  } catch (e) {
    console.warn("could not resolve notification icon:", e);
  }

  // Hook the router up with a real Routing implementation.
  setRoutingForTesting({
    paneForSession: paneForSessionLookup,
    tabForPane: findTabIdByPaneId,
    tabName: (tabId: number) => {
      const t = findTabById(tabId);
      return t ? (t.titleOverride ?? t.name) : `tab ${tabId}`;
    },
    cwdBasename: paneCwdBasename,
    windowFocused: () => document.hasFocus(),
    prefs: () => {
      const p = getPrefs();
      return {
        notifyOnStop: p.notifyOnStop === true,
        notifyOnPermission: p.notifyOnPermission === true,
        notifySoundEnabled: p.notifySoundEnabled === true,
      };
    },
    paint: async (req: PaintRequest) => {
      try {
        const focusPane = () => {
          switchTab(req.tabId);
          requestAnimationFrame(() => setActivePane(req.paneId));
        };

        // 1. Tab badge — only paint when not on that tab.
        if (getActiveTab()?.id !== req.tabId) {
          setTabBadge(req.tabId, req.kind === "notification" ? "perm" : "stop");
        }

        // 2. Pane head badge — only paint when on that tab but not that pane.
        if (getActiveTab()?.id === req.tabId && getActivePaneId() !== req.paneId) {
          setPaneBadge(req.paneId, req.kind === "notification" ? "perm" : "stop");
        }

        // 3. Toast — always.
        showToast({
          kind: "info",
          accent: req.kind === "notification" ? "perm" : "stop",
          message:
            req.kind === "notification"
              ? `Claude needs permission in ${req.tabName}`
              : `Claude finished in ${req.tabName}`,
          detail: req.message ?? undefined,
          durationMs: 30_000,
          onClick: focusPane,
        });

        // 4. macOS notification — only when window unfocused.
        if (req.fireMacOsNotification) {
          let granted = await isPermissionGranted();
          if (!granted) {
            granted = (await requestPermission()) === "granted";
          }
          if (granted) {
            const body = req.cwdBasename
              ? `${req.tabName} · ${req.cwdBasename}`
              : req.tabName;
            sendNotification({
              title: req.kind === "notification" ? "Claude needs permission" : "Claude finished",
              body,
              icon: notificationIcon,
            });
            pendingFocus = {
              tabId: req.tabId,
              paneId: req.paneId,
              expiresAt: Date.now() + PENDING_FOCUS_TTL_MS,
            };
          }
        }
      } catch (e) {
        console.warn("claude-notifications paint failed:", e);
      }
    },
  });

  ensureFocusListener((tabId, paneId) => {
    switchTab(tabId);
    requestAnimationFrame(() => setActivePane(paneId));
  });

  // Listen for backend socket events and route them.
  await listen<NotifyEvent>("claude-notify", (msg) => {
    handleNotifyEvent(msg.payload);
  });
}
