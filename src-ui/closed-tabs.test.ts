import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  pushClosedTab,
  popClosedTab,
  closedTabsCount,
  clearClosedTabs,
  shapeFromTreeAsync,
  firstLeafCwd,
  firstLeafScrollback,
  firstLeafClaudeResume,
  restoredSeparator,
  type ClosedTabEntry,
  type ClosedTabShape,
} from "./closed-tabs";

// Mock the claude-session-probe so shapeFromTreeAsync's per-leaf probe
// resolves predictably without poking Tauri.
vi.mock("./claude-session-probe", () => ({
  probeClaudeSession: vi.fn(),
}));

import { probeClaudeSession } from "./claude-session-probe";
const probeMock = probeClaudeSession as unknown as ReturnType<typeof vi.fn>;

function entry(name: string, cwd = `/tmp/${name}`): ClosedTabEntry {
  return {
    shape: { type: "leaf", cwd },
    name,
    originalIndex: 0,
  };
}

describe("closed-tabs stack", () => {
  beforeEach(() => clearClosedTabs());

  it("starts empty", () => {
    expect(closedTabsCount()).toBe(0);
    expect(popClosedTab()).toBeUndefined();
  });

  it("pop returns entries in LIFO order", () => {
    pushClosedTab(entry("a"));
    pushClosedTab(entry("b"));
    pushClosedTab(entry("c"));
    expect(closedTabsCount()).toBe(3);
    expect(popClosedTab()?.name).toBe("c");
    expect(popClosedTab()?.name).toBe("b");
    expect(popClosedTab()?.name).toBe("a");
    expect(popClosedTab()).toBeUndefined();
  });

  it("caps at MAX_DEPTH=10 and drops the oldest entry", () => {
    for (let i = 0; i < 12; i++) pushClosedTab(entry(`t${i}`));
    expect(closedTabsCount()).toBe(10);
    // Newest stays on top; t0 and t1 evicted.
    expect(popClosedTab()?.name).toBe("t11");
    // Walk down: should hit t10, t9, ..., t2.
    const remaining: string[] = [];
    while (closedTabsCount() > 0) remaining.push(popClosedTab()!.name);
    expect(remaining).toEqual(["t10", "t9", "t8", "t7", "t6", "t5", "t4", "t3", "t2"]);
  });

  it("clearClosedTabs empties the stack", () => {
    pushClosedTab(entry("a"));
    pushClosedTab(entry("b"));
    clearClosedTabs();
    expect(closedTabsCount()).toBe(0);
    expect(popClosedTab()).toBeUndefined();
  });

  it("pushed entry is preserved verbatim (shape, name, titleOverride, originalIndex)", () => {
    const splitShape: ClosedTabShape = {
      type: "split",
      axis: "vertical",
      first: { type: "leaf", cwd: "/a" },
      second: { type: "leaf", cwd: "/b" },
    };
    pushClosedTab({
      shape: splitShape,
      name: "myproj",
      titleOverride: "vim: foo.ts",
      originalIndex: 3,
    });
    const popped = popClosedTab();
    expect(popped?.shape).toEqual(splitShape);
    expect(popped?.name).toBe("myproj");
    expect(popped?.titleOverride).toBe("vim: foo.ts");
    expect(popped?.originalIndex).toBe(3);
  });
});

describe("shapeFromTreeAsync", () => {
  beforeEach(() => probeMock.mockReset());

  it("strips DOM and session refs from a leaf, preserving cwd", async () => {
    probeMock.mockResolvedValue(null);
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: { cwd: "/home/luca/proj", ptyId: 7, serialize: () => "" } as any,
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(fakeLeaf)).toEqual({
      type: "leaf",
      cwd: "/home/luca/proj",
      scrollback: undefined,
    });
  });

  it("treats null session.cwd as null shape cwd", async () => {
    probeMock.mockResolvedValue(null);
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: { cwd: null, ptyId: 7, serialize: () => "" } as any,
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(fakeLeaf)).toEqual({
      type: "leaf",
      cwd: null,
      scrollback: undefined,
    });
  });

  it("preserves nested split topology", async () => {
    probeMock.mockResolvedValue(null);
    const tree = {
      type: "split" as const,
      axis: "vertical" as const,
      first: {
        type: "split" as const,
        axis: "horizontal" as const,
        first: {
          type: "leaf" as const,
          paneId: 1,
          session: { cwd: "/a", ptyId: 1, serialize: () => "" } as any,
          element: document.createElement("div"),
        },
        second: {
          type: "leaf" as const,
          paneId: 2,
          session: { cwd: "/b", ptyId: 2, serialize: () => "" } as any,
          element: document.createElement("div"),
        },
        element: document.createElement("div"),
      },
      second: {
        type: "leaf" as const,
        paneId: 3,
        session: { cwd: "/c", ptyId: 3, serialize: () => "" } as any,
        element: document.createElement("div"),
      },
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(tree)).toEqual({
      type: "split",
      axis: "vertical",
      first: {
        type: "split",
        axis: "horizontal",
        first: { type: "leaf", cwd: "/a", scrollback: undefined },
        second: { type: "leaf", cwd: "/b", scrollback: undefined },
      },
      second: { type: "leaf", cwd: "/c", scrollback: undefined },
    });
  });

  it("captures scrollback from a leaf session", async () => {
    probeMock.mockResolvedValue(null);
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: {
        cwd: "/a",
        ptyId: 7,
        serialize: () => "ls\r\nfile1\r\n$ ",
      } as any,
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(fakeLeaf)).toEqual({
      type: "leaf",
      cwd: "/a",
      scrollback: "ls\r\nfile1\r\n$ ",
    });
  });

  it("normalizes empty serialize result to undefined (skip separator)", async () => {
    probeMock.mockResolvedValue(null);
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: { cwd: "/a", ptyId: 7, serialize: () => "" } as any,
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(fakeLeaf)).toEqual({
      type: "leaf",
      cwd: "/a",
      scrollback: undefined,
    });
  });

  it("captures scrollback for each leaf in a nested split independently", async () => {
    probeMock.mockResolvedValue(null);
    const tree = {
      type: "split" as const,
      axis: "vertical" as const,
      first: {
        type: "leaf" as const,
        paneId: 1,
        session: { cwd: "/a", ptyId: 1, serialize: () => "leaf-A-output" } as any,
        element: document.createElement("div"),
      },
      second: {
        type: "split" as const,
        axis: "horizontal" as const,
        first: {
          type: "leaf" as const,
          paneId: 2,
          session: { cwd: "/b", ptyId: 2, serialize: () => "leaf-B-output" } as any,
          element: document.createElement("div"),
        },
        second: {
          type: "leaf" as const,
          paneId: 3,
          session: { cwd: "/c", ptyId: 3, serialize: () => "leaf-C-output" } as any,
          element: document.createElement("div"),
        },
        element: document.createElement("div"),
      },
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(tree)).toEqual({
      type: "split",
      axis: "vertical",
      first: { type: "leaf", cwd: "/a", scrollback: "leaf-A-output" },
      second: {
        type: "split",
        axis: "horizontal",
        first: { type: "leaf", cwd: "/b", scrollback: "leaf-B-output" },
        second: { type: "leaf", cwd: "/c", scrollback: "leaf-C-output" },
      },
    });
  });

  it("swallows serialize() throws and stores undefined", async () => {
    probeMock.mockResolvedValue(null);
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: {
        cwd: "/a",
        ptyId: 7,
        serialize: () => { throw new Error("simulated"); },
      } as any,
      element: document.createElement("div"),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await shapeFromTreeAsync(fakeLeaf)).toEqual({
      type: "leaf",
      cwd: "/a",
      scrollback: undefined,
    });
    warn.mockRestore();
  });

  it("attaches claudeResume to a leaf when the probe resolves a uuid", async () => {
    probeMock.mockImplementation(async (ptyId: number) =>
      ptyId === 42
        ? { uuid: "d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d" }
        : null,
    );
    const tree = {
      type: "split" as const,
      axis: "vertical" as const,
      first: {
        type: "leaf" as const,
        paneId: 1,
        session: { cwd: "/a", ptyId: 1, serialize: () => "" } as any,
        element: document.createElement("div"),
      },
      second: {
        type: "leaf" as const,
        paneId: 2,
        session: { cwd: "/b", ptyId: 42, serialize: () => "" } as any,
        element: document.createElement("div"),
      },
      element: document.createElement("div"),
    };
    expect(await shapeFromTreeAsync(tree)).toEqual({
      type: "split",
      axis: "vertical",
      first: { type: "leaf", cwd: "/a", scrollback: undefined },
      second: {
        type: "leaf",
        cwd: "/b",
        scrollback: undefined,
        claudeResume: { uuid: "d2c1d5a4-7f3a-4b8b-9bb3-1e5c6f9a3b2d" },
      },
    });
  });

  it("calls the probe in parallel across all leaves of a split", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    probeMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return null;
    });
    const tree = {
      type: "split" as const,
      axis: "vertical" as const,
      first: {
        type: "leaf" as const,
        paneId: 1,
        session: { cwd: "/a", ptyId: 1, serialize: () => "" } as any,
        element: document.createElement("div"),
      },
      second: {
        type: "leaf" as const,
        paneId: 2,
        session: { cwd: "/b", ptyId: 2, serialize: () => "" } as any,
        element: document.createElement("div"),
      },
      element: document.createElement("div"),
    };
    await shapeFromTreeAsync(tree);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });
});

describe("firstLeafCwd", () => {
  it("returns the cwd of a leaf shape directly", () => {
    expect(firstLeafCwd({ type: "leaf", cwd: "/x" })).toBe("/x");
    expect(firstLeafCwd({ type: "leaf", cwd: null })).toBeNull();
  });

  it("walks left through nested splits to find the first leaf", () => {
    const shape: ClosedTabShape = {
      type: "split",
      axis: "vertical",
      first: {
        type: "split",
        axis: "horizontal",
        first: { type: "leaf", cwd: "/leftmost" },
        second: { type: "leaf", cwd: "/inner-right" },
      },
      second: { type: "leaf", cwd: "/right" },
    };
    expect(firstLeafCwd(shape)).toBe("/leftmost");
  });
});


describe("firstLeafScrollback", () => {
  it("returns the leaf's scrollback when shape is a leaf", () => {
    expect(
      firstLeafScrollback({ type: "leaf", cwd: "/a", scrollback: "hello" }),
    ).toBe("hello");
  });

  it("returns undefined when leaf has no scrollback", () => {
    expect(firstLeafScrollback({ type: "leaf", cwd: "/a" })).toBeUndefined();
  });

  it("walks left through splits to find the first leaf's scrollback", () => {
    const shape: ClosedTabShape = {
      type: "split",
      axis: "vertical",
      first: {
        type: "split",
        axis: "horizontal",
        first: { type: "leaf", cwd: "/a", scrollback: "leftmost" },
        second: { type: "leaf", cwd: "/b", scrollback: "inner-right" },
      },
      second: { type: "leaf", cwd: "/c", scrollback: "right" },
    };
    expect(firstLeafScrollback(shape)).toBe("leftmost");
  });
});

describe("firstLeafClaudeResume", () => {
  it("returns the leaf's claudeResume when shape is a leaf", () => {
    expect(
      firstLeafClaudeResume({
        type: "leaf",
        cwd: "/a",
        claudeResume: { uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      }),
    ).toEqual({ uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
  });

  it("returns undefined when leaf has no claudeResume", () => {
    expect(firstLeafClaudeResume({ type: "leaf", cwd: "/a" })).toBeUndefined();
  });

  it("walks left through splits to find the first leaf's claudeResume", () => {
    const shape: ClosedTabShape = {
      type: "split",
      axis: "vertical",
      first: {
        type: "split",
        axis: "horizontal",
        first: {
          type: "leaf",
          cwd: "/a",
          claudeResume: { uuid: "leftmost-uuid-leftmost-uuid-leftmost00" },
        },
        second: { type: "leaf", cwd: "/b" },
      },
      second: { type: "leaf", cwd: "/c" },
    };
    expect(firstLeafClaudeResume(shape)).toEqual({
      uuid: "leftmost-uuid-leftmost-uuid-leftmost00",
    });
  });
});

describe("restoredSeparator", () => {
  it("contains the human-readable label and at least one ANSI escape", () => {
    const sep = restoredSeparator();
    expect(sep).toContain("reopened from closed tab");
    // \x1b[...m is the SGR escape pattern.
    expect(sep).toMatch(/\x1b\[[\d;]+m/);
  });

  it("starts and ends with a CRLF so it never appends to a partial line", () => {
    const sep = restoredSeparator();
    expect(sep.startsWith("\r\n")).toBe(true);
    expect(sep.endsWith("\r\n")).toBe(true);
  });
});
