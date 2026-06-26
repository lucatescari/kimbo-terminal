// "Accept first mouse" (set on the window) lets the click that activates a
// background Kimbo window land in the webview, so clicking a pane focuses THAT
// pane on the first click (see panes.ts mousedown → setActivePane). The catch:
// that same activating click is now also live over the chrome, so it could
// accidentally trigger a destructive control — most notably a tab's close (✕).
//
// We record when the window last gained focus and treat a click within a short
// window of that as "the activating click", which destructive controls ignore.
// Native macOS traffic-light buttons accept first mouse anyway, so we only
// guard our own destructive affordances (the tab close button).

export const ACTIVATION_GUARD_MS = 250;

let lastFocusAt = -Infinity;

/** Pure: is `now` inside the guard window that opens at `focusAt`? */
export function isWithinActivationGuard(focusAt: number, now: number): boolean {
  return now - focusAt < ACTIVATION_GUARD_MS;
}

/** True when the current click is (almost certainly) the one that just
 *  activated the window, so a destructive control should ignore it. */
export function isActivatingClick(now: number = Date.now()): boolean {
  return isWithinActivationGuard(lastFocusAt, now);
}

/** Wire the window-focus tracker. Called once at startup. */
export function initWindowActivationTracking(): void {
  window.addEventListener("focus", () => {
    lastFocusAt = Date.now();
  });
}

/** Test-only: set the recorded focus time directly. */
export function __setLastFocusForTest(t: number): void {
  lastFocusAt = t;
}
