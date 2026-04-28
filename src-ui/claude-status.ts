import { invoke } from "@tauri-apps/api/core";

/** Live status for a Claude Code session running in a PTY. Returned by
 *  the `claude_status` Tauri command. snake_case fields match the Rust
 *  serde-serialized struct directly. */
export interface ClaudeStatus {
  session_id: string;
  model: string | null;
  started_at_ms: number;
  input_tokens: number;
  output_tokens: number;
  permission_mode: string | null;
  message_count: number;
  tool_count: number;
}

/** Best-effort lookup of a running Claude Code session for a PTY. The
 *  backend walks the PTY's process descendants and reads
 *  ~/.claude/sessions/<pid>.json + the session's JSONL log. Returns
 *  null for "no claude here", "missing sessions file", or any error. */
export async function claudeStatus(ptyId: number): Promise<ClaudeStatus | null> {
  try {
    const result = await invoke<ClaudeStatus | null>("claude_status", { id: ptyId });
    return result ?? null;
  } catch (e) {
    console.warn("claudeStatus failed:", e);
    return null;
  }
}
