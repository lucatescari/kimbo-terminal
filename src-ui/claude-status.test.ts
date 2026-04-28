import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { claudeStatus } from "./claude-status";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => invokeMock.mockReset());

describe("claudeStatus", () => {
  it("invokes the claude_status command with the pty id", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await claudeStatus(7);
    expect(invokeMock).toHaveBeenCalledWith("claude_status", { id: 7 });
  });

  it("returns the status object on a hit", async () => {
    const fixture = {
      session_id: "abc",
      model: "claude-opus-4-7",
      started_at_ms: 100,
      input_tokens: 10,
      output_tokens: 5,
      permission_mode: null,
      message_count: 1,
      tool_count: 0,
    };
    invokeMock.mockResolvedValueOnce(fixture);
    expect(await claudeStatus(7)).toEqual(fixture);
  });

  it("returns null when backend returns null", async () => {
    invokeMock.mockResolvedValueOnce(null);
    expect(await claudeStatus(7)).toBeNull();
  });

  it("swallows errors and returns null", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await claudeStatus(7)).toBeNull();
    warn.mockRestore();
  });
});
