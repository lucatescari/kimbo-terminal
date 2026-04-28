import { invoke } from "@tauri-apps/api/core";

/** Backend payload returned by the `probe_claude_session` Tauri command. */
export interface ClaudeResume {
  uuid: string;
}

/** Best-effort lookup of a running Claude Code session id for a PTY. The
 *  backend walks the PTY's process descendants and matches an open
 *  ~/.claude/projects/.../uuid.jsonl fd. Returns null for "no claude
 *  here", probe budget exhaustion, or any backend error — callers in
 *  the close flow treat all three the same. */
export async function probeClaudeSession(
  ptyId: number,
): Promise<ClaudeResume | null> {
  try {
    const result = await invoke<ClaudeResume | null>("probe_claude_session", {
      id: ptyId,
    });
    return result ?? null;
  } catch (e) {
    console.warn("probeClaudeSession failed:", e);
    return null;
  }
}
