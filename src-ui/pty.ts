import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export async function createPty(cwd?: string): Promise<number> {
  return await invoke<number>("create_pty", { cwd: cwd ?? null });
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

export function onPtyOutput(
  id: number,
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty-output-${id}`, (event) => {
    // Decode base64 from Rust backend.
    const binary = atob(event.payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    callback(bytes);
  });
}

export function onPtyExit(
  id: number,
  callback: () => void,
): Promise<UnlistenFn> {
  return listen(`pty-exit-${id}`, () => callback());
}
