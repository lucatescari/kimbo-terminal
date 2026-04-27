import { describe, it, expect, beforeEach } from "vitest";
import {
  pushClosedTab,
  popClosedTab,
  closedTabsCount,
  clearClosedTabs,
  shapeFromTree,
  firstLeafCwd,
  type ClosedTabEntry,
  type ClosedTabShape,
} from "./closed-tabs";

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

describe("shapeFromTree", () => {
  it("strips DOM and session refs from a leaf, preserving cwd", () => {
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: { cwd: "/home/luca/proj" } as any,
      element: document.createElement("div"),
    };
    expect(shapeFromTree(fakeLeaf)).toEqual({
      type: "leaf",
      cwd: "/home/luca/proj",
    });
  });

  it("treats null session.cwd as null shape cwd", () => {
    const fakeLeaf = {
      type: "leaf" as const,
      paneId: 1,
      session: { cwd: null } as any,
      element: document.createElement("div"),
    };
    expect(shapeFromTree(fakeLeaf)).toEqual({ type: "leaf", cwd: null });
  });

  it("preserves nested split topology", () => {
    const tree = {
      type: "split" as const,
      axis: "vertical" as const,
      first: {
        type: "split" as const,
        axis: "horizontal" as const,
        first: {
          type: "leaf" as const,
          paneId: 1,
          session: { cwd: "/a" } as any,
          element: document.createElement("div"),
        },
        second: {
          type: "leaf" as const,
          paneId: 2,
          session: { cwd: "/b" } as any,
          element: document.createElement("div"),
        },
        element: document.createElement("div"),
      },
      second: {
        type: "leaf" as const,
        paneId: 3,
        session: { cwd: "/c" } as any,
        element: document.createElement("div"),
      },
      element: document.createElement("div"),
    };
    expect(shapeFromTree(tree)).toEqual({
      type: "split",
      axis: "vertical",
      first: {
        type: "split",
        axis: "horizontal",
        first: { type: "leaf", cwd: "/a" },
        second: { type: "leaf", cwd: "/b" },
      },
      second: { type: "leaf", cwd: "/c" },
    });
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
