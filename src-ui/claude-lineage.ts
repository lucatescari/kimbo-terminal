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
