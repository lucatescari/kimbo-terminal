import { describe, it, expect, beforeEach } from "vitest";
import {
  pushClosedTab,
  popClosedTab,
  closedTabsCount,
  clearClosedTabs,
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
