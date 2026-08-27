// Wires the pure lineage watcher to Kimbo's real backend and pane machinery.
//
// Kept apart from claude-lineage.ts so that module stays free of Tauri and
// panes imports and its logic can be tested without either.

import { invoke } from "@tauri-apps/api/core";
import { getPrefs } from "./ui-prefs";
import {
  createLineageWatcher,
  type AgentInfo,
  type LineageEvent,
} from "./claude-lineage";

/** Backend shape of `claude agents --json`, one entry per session. */
interface RawAgent {
  session_id: string;
  kind: string | null;
  cwd: string | null;
  name: string | null;
  state: string | null;
}

async function openSplit(
  event: LineageEvent,
  paneId: number,
  cwd: string | null,
): Promise<void> {
  if (event.kind === "none") return;

  // Imported lazily: panes.ts is what calls into this module, so a static
  // import here would be a cycle.
  const { splitLeaf } = await import("./panes");
  const { showToast } = await import("./toast");

  // /branch moves the pane's own conversation onto the branch and leaves the
  // original as a transcript, so the original is RESUMED. /fork leaves a real
  // background session running, so that one is ATTACHED to via claude's own
  // picker, since there is no non-interactive attach flag.
  const command =
    event.kind === "branch"
      ? ["claude", "--resume", event.originSessionId]
      : ["claude", "agents"];

  const target = getPrefs().claudeSplitTarget ?? "vertical";

  if (target === "tab") {
    const { createTab } = await import("./tabs");
    await createTab(cwd ?? undefined, undefined, undefined, undefined, command);
  } else {
    const result = await splitLeaf(
      paneId,
      target,
      cwd ?? undefined,
      undefined,
      undefined,
      command,
    );
    // splitLeaf returns undefined when the pane has gone away underneath us.
    // Say nothing rather than claim a split that did not happen.
    if (!result) return;
  }

  // Say what happened. An unexplained new pane is the failure mode this
  // feature is most likely to be disliked for.
  const where = target === "tab" ? "a new tab" : "a split";
  showToast({
    kind: "info",
    message:
      event.kind === "branch"
        ? `Branched. Opened the original conversation in ${where}.`
        : `Forked. Opened the background session in ${where}.`,
  });
}

const watcher = createLineageWatcher({
  sessionOrigin: (sessionId) =>
    invoke<string | null>("claude_session_origin", { sessionId }),
  listAgents: async (): Promise<AgentInfo[]> => {
    const raw = await invoke<RawAgent[]>("claude_agents");
    return raw ?? [];
  },
  openSplit,
  now: () => Date.now(),
  // Read per call so toggling the pref takes effect without a restart.
  enabled: () => getPrefs().claudeAutoSplitBranches !== false,
});

/** Called from the per-pane Claude poll whenever a session is running. */
export function observeClaudeSession(
  paneId: number,
  sessionId: string,
  cwd: string | null,
): void {
  // Fire and forget: the poll must not wait on a shell-out or a split.
  void watcher.observe(paneId, sessionId, cwd).catch((e) => {
    console.warn("claude lineage observe failed:", e);
  });
}

/** Called when a pane closes, so a recycled pane id can't look like a branch. */
export function forgetClaudePane(paneId: number): void {
  watcher.forgetPane(paneId);
}
