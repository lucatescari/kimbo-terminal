// Maps a Claude session id (UUID, from the existing claude_status probe) to
// the paneId where that session is running. Updated by panes.ts on every
// claude poll, cleared on pane disposal. Read by claude-notifications.ts to
// route socket events to the right pane.

const map = new Map<string, number>();

export function setSessionPane(sessionId: string, paneId: number): void {
  map.set(sessionId, paneId);
}

export function paneForSession(sessionId: string): number | null {
  return map.get(sessionId) ?? null;
}

/** Drop every entry pointing to `paneId`. Called when a pane is closed. */
export function removePane(paneId: number): void {
  for (const [k, v] of map) {
    if (v === paneId) map.delete(k);
  }
}

/** Test-only: reset between tests. */
export function clearSessionMapForTesting(): void {
  map.clear();
}
