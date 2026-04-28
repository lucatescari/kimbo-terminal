import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { probeClaudeSession } from "./claude-session-probe";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe("probeClaudeSession", () => {
  it("invokes the probe_claude_session command with the pty id", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await probeClaudeSession(42);
    expect(invokeMock).toHaveBeenCalledWith("probe_claude_session", { id: 42 });
  });

  it("returns the uuid object when the backend reports a match", async () => {
    invokeMock.mockResolvedValueOnce({ uuid: "d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d" });
    const result = await probeClaudeSession(7);
    expect(result).toEqual({ uuid: "d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d" });
  });

  it("returns null when the backend reports no claude descendant", async () => {
    invokeMock.mockResolvedValueOnce(null);
    expect(await probeClaudeSession(7)).toBeNull();
  });

  it("returns null and swallows errors so close-flow callers can ignore failures", async () => {
    invokeMock.mockRejectedValueOnce(new Error("PTY not found"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await probeClaudeSession(99)).toBeNull();
    warn.mockRestore();
  });
});
