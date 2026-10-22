import { describe, it, expect, vi, beforeEach } from "vitest";

// pty.ts is the only module that talks to the Rust PTY commands. The output
// listener hands each chunk to the terminal together with an `ack` the
// terminal calls once the bytes are parsed; that ack is what lets the Rust
// reader thread continue past its unacknowledged-bytes limit.

const invoke = vi.fn().mockResolvedValue(undefined);
let listenHandler: ((e: { payload: string }) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, h: (e: { payload: string }) => void) => {
    listenHandler = h;
    return () => {};
  }),
}));

import { onPtyOutput } from "./pty";

describe("onPtyOutput acknowledgement", () => {
  beforeEach(() => {
    invoke.mockClear();
    listenHandler = null;
  });

  it("decodes the chunk and acks its raw byte length via ack_pty", async () => {
    const received: Array<{ data: Uint8Array; ack: () => void }> = [];
    await onPtyOutput(7, (data, ack) => received.push({ data, ack }));
    expect(listenHandler).not.toBeNull();

    listenHandler!({ payload: btoa("hello") });
    expect(received).toHaveLength(1);
    expect(new TextDecoder().decode(received[0].data)).toBe("hello");
    expect(invoke).not.toHaveBeenCalledWith("ack_pty", expect.anything());

    received[0].ack();
    expect(invoke).toHaveBeenCalledWith("ack_pty", { id: 7, bytes: 5 });
  });
});
