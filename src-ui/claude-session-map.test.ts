import { describe, expect, it, beforeEach } from "vitest";
import {
  setSessionPane,
  paneForSession,
  removePane,
  clearSessionMapForTesting,
} from "./claude-session-map";

describe("claude-session-map", () => {
  beforeEach(() => clearSessionMapForTesting());

  it("returns null for unknown session", () => {
    expect(paneForSession("nope")).toBeNull();
  });

  it("returns paneId after setSessionPane", () => {
    setSessionPane("sess-1", 42);
    expect(paneForSession("sess-1")).toBe(42);
  });

  it("overwrites previous pane for the same session", () => {
    setSessionPane("sess-1", 42);
    setSessionPane("sess-1", 99);
    expect(paneForSession("sess-1")).toBe(99);
  });

  it("removePane drops only entries pointing to that pane", () => {
    setSessionPane("a", 1);
    setSessionPane("b", 2);
    setSessionPane("c", 1);
    removePane(1);
    expect(paneForSession("a")).toBeNull();
    expect(paneForSession("c")).toBeNull();
    expect(paneForSession("b")).toBe(2);
  });
});
