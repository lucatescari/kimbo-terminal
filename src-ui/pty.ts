import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/** Create a PTY. `command`, when given, is an argv the pane runs before
 *  dropping to an interactive shell — used to open a pane directly on a
 *  Claude session. */
export async function createPty(
  cwd?: string,
  command?: string[],
): Promise<number> {
  return await invoke<number>("create_pty", {
    cwd: cwd ?? null,
    command: command ?? null,
  });
}

export async function writePty(id: number, data: string): Promise<void> {
  await invoke("write_pty", { id, data });
}

export async function resizePty(
  id: number,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("resize_pty", { id, cols, rows });
}

export async function closePty(id: number): Promise<void> {
  await invoke("close_pty", { id });
}

export async function getCwd(id: number): Promise<string | null> {
  return await invoke<string | null>("get_cwd", { id });
}

/** True when the PTY's foreground process group is NOT the shell itself
 *  — i.e. the shell has spawned a child (vim, `npm run dev`, `claude`, …)
 *  and is currently blocked waiting on it. Used by the confirm-quit flow
 *  to distinguish "idle prompt" panes from "running something" panes. */
export async function ptyIsBusy(id: number): Promise<boolean> {
  return await invoke<boolean>("pty_is_busy", { id });
}

/** Subscribe to PTY output. `ack` must be called once xterm has parsed the
 *  chunk: the Rust reader thread stops reading while more than its limit of
 *  bytes is unacknowledged, which is what keeps a fast `cat` from piling up
 *  inside the webview. */
export function onPtyOutput(
  id: number,
  callback: (data: Uint8Array, ack: () => void) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty-output-${id}`, (event) => {
    // Decode base64 from Rust backend.
    const binary = atob(event.payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const ack = () => {
      invoke("ack_pty", { id, bytes: bytes.length }).catch(() => {
        /* the session is gone; the reader was released by close_pty */
      });
    };
    callback(bytes, ack);
  });
}

export function onPtyExit(
  id: number,
  callback: () => void,
): Promise<UnlistenFn> {
  return listen(`pty-exit-${id}`, () => callback());
}
