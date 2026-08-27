// Detects when a Claude Code session in a pane branches or forks, so Kimbo can
// open the other side of the split in its own pane.
//
// The two commands leave different fingerprints, and conflating them is the
// easy mistake:
//
//   /branch  "Create a branch of the current conversation at this point".
//            The pane's OWN session id changes A -> B, and B's transcript
//            records forkedFrom.sessionId === A. Crucially the original is
//            NOT left running: the same process moves onto the branch and A
//            becomes a transcript on disk. Reopening it means resuming it.
//
//   /fork    "Copy this conversation into a new background session and keep
//            working here". The pane's session id does NOT change. A new
//            background session appears and both really do keep running, so
//            the other side is attached to rather than resumed.

/** What a single observed transition means for one pane. */
export type LineageEvent =
  | { kind: "none" }
  | { kind: "branch"; originSessionId: string; newSessionId: string }
  | { kind: "fork"; forkSessionId: string };

export interface TransitionInput {
  /** The session id Kimbo last saw in this pane, or null if this is the first
   *  time it has looked. Null is not "no session" — it is "no opinion yet". */
  previousSessionId: string | null;
  /** The session id the pane is running now. */
  currentSessionId: string;
  /** `forkedFrom.sessionId` from the current session's transcript, if any. */
  forkedFromSessionId: string | null;
  /** Background sessions that appeared since the last observation, oldest
   *  first, already filtered to this pane's working directory by the caller. */
  newBackgroundSessionIds: string[];
}

/** Decide what a transition means. Pure, so the interesting cases are
 *  testable without a PTY or a running claude. */
export function classifyTransition(input: TransitionInput): LineageEvent {
  const {
    previousSessionId,
    currentSessionId,
    forkedFromSessionId,
    newBackgroundSessionIds,
  } = input;

  // First sighting of a pane is not a transition. Without this, launching
  // Kimbo with several panes already running claude would split every one of
  // them at once — the worst possible first impression of the feature.
  if (previousSessionId === null) return { kind: "none" };

  if (currentSessionId !== previousSessionId) {
    // A branch is specifically a session that descends from the one this pane
    // was just running. Any other id change is a quit-and-restart or an
    // unrelated resume, where there is no "original" worth reopening.
    if (forkedFromSessionId === previousSessionId) {
      return {
        kind: "branch",
        originSessionId: previousSessionId,
        newSessionId: currentSessionId,
      };
    }
    return { kind: "none" };
  }

  // Session unchanged: a fork is the only thing that can have happened. Act on
  // the most recent, which is the one the user just created.
  if (newBackgroundSessionIds.length > 0) {
    return {
      kind: "fork",
      forkSessionId: newBackgroundSessionIds[newBackgroundSessionIds.length - 1],
    };
  }

  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/** A session as reported by `claude agents --json`. */
export interface AgentInfo {
  session_id: string;
  kind: string | null;
  cwd: string | null;
  name: string | null;
  state: string | null;
}

/** Everything the watcher touches that isn't pure, injected so the throttling
 *  and dedupe can be tested without a PTY, a shell, or a running claude. */
export interface LineageDeps {
  /** forkedFrom.sessionId for a session, or null if it isn't a branch. */
  sessionOrigin(sessionId: string): Promise<string | null>;
  /** Every session the CLI knows about. Spawns a login shell, so the watcher
   *  throttles calls to it rather than asking on every poll. */
  listAgents(): Promise<AgentInfo[]>;
  /** Open the other side of the split. */
  openSplit(event: LineageEvent, paneId: number, cwd: string | null): Promise<void>;
  now(): number;
  /** Read fresh each time: the user can toggle the pref mid-session. */
  enabled(): boolean;
}

/** Minimum gap between `claude agents` calls. Fork detection is allowed to lag
 *  by a few seconds; spawning a login shell on every pane's poll is not. */
export const AGENTS_MIN_INTERVAL_MS = 6000;

export function createLineageWatcher(deps: LineageDeps) {
  const lastSeen = new Map<number, string>();
  /** Background sessions already known, so only genuinely new ones count as a
   *  fork. Seeded on the first successful listing. */
  let knownBackground: Set<string> | null = null;
  /** Events already acted on, keyed by the session the split would open.
   *  Without this a branch would re-split on every subsequent poll, since the
   *  pane's session id stays changed. */
  const handled = new Set<string>();
  let lastAgentsAt = 0;
  let agents: AgentInfo[] = [];

  async function refreshAgents(): Promise<void> {
    if (deps.now() - lastAgentsAt < AGENTS_MIN_INTERVAL_MS) return;
    lastAgentsAt = deps.now();
    try {
      agents = await deps.listAgents();
    } catch {
      // A failed listing must not break the poll or wrongly look like "every
      // background session disappeared".
      return;
    }
    if (knownBackground === null) {
      // First listing seeds the baseline. Sessions already running when Kimbo
      // started are not forks the user just made.
      knownBackground = new Set(
        agents.filter((a) => a.kind === "background").map((a) => a.session_id),
      );
    }
  }

  /** Called on every Claude poll for a pane that has a session running. */
  async function observe(
    paneId: number,
    sessionId: string,
    cwd: string | null,
  ): Promise<void> {
    if (!deps.enabled()) {
      // Still track the id, so turning the pref back on later doesn't treat a
      // long-running session as a fresh branch.
      lastSeen.set(paneId, sessionId);
      return;
    }

    const previousSessionId = lastSeen.get(paneId) ?? null;
    lastSeen.set(paneId, sessionId);

    await refreshAgents();

    const newBackgroundSessionIds = agents
      .filter((a) => a.kind === "background")
      .filter((a) => !knownBackground || !knownBackground.has(a.session_id))
      .filter((a) => cwd === null || a.cwd === null || a.cwd === cwd)
      .map((a) => a.session_id);

    let forkedFromSessionId: string | null = null;
    if (previousSessionId !== null && sessionId !== previousSessionId) {
      // Only worth asking when the id actually moved.
      try {
        forkedFromSessionId = await deps.sessionOrigin(sessionId);
      } catch {
        forkedFromSessionId = null;
      }
    }

    const event = classifyTransition({
      previousSessionId,
      currentSessionId: sessionId,
      forkedFromSessionId,
      newBackgroundSessionIds,
    });

    // Whatever we decide, these background sessions are no longer new.
    for (const id of newBackgroundSessionIds) knownBackground?.add(id);

    if (event.kind === "none") return;

    const key =
      event.kind === "branch"
        ? `branch:${event.newSessionId}`
        : `fork:${event.forkSessionId}`;
    if (handled.has(key)) return;
    handled.add(key);

    try {
      await deps.openSplit(event, paneId, cwd);
    } catch {
      // A failed split leaves the key marked handled on purpose: retrying on
      // the next poll would produce a split attempt every few seconds for as
      // long as the pane lives.
    }
  }

  function forgetPane(paneId: number): void {
    lastSeen.delete(paneId);
  }

  return { observe, forgetPane };
}
