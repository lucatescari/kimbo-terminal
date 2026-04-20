import { describe, it, expect } from "vitest";

// Test the split tree data model in isolation (no DOM, no xterm.js).
// We replicate the tree types and pure functions from panes.ts.

type SplitAxis = "vertical" | "horizontal";

interface LeafNode {
  type: "leaf";
  paneId: number;
}

interface SplitNode {
  type: "split";
  axis: SplitAxis;
  first: TestTree;
  second: TestTree;
}

type TestTree = LeafNode | SplitNode;

function leaf(id: number): LeafNode {
  return { type: "leaf", paneId: id };
}

function split(axis: SplitAxis, first: TestTree, second: TestTree): SplitNode {
  return { type: "split", axis, first, second };
}

function findLeaf(node: TestTree, id: number): LeafNode | null {
  if (node.type === "leaf") return node.paneId === id ? node : null;
  return findLeaf(node.first, id) || findLeaf(node.second, id);
}

function findFirstLeaf(node: TestTree): LeafNode | null {
  if (node.type === "leaf") return node;
  return findFirstLeaf(node.first);
}

function collectLeaves(node: TestTree): LeafNode[] {
  if (node.type === "leaf") return [node];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

function countLeaves(node: TestTree): number {
  return collectLeaves(node).length;
}

function findParentSplit(
  node: TestTree,
  leafId: number,
): { parent: SplitNode; sibling: TestTree } | null {
  if (node.type === "leaf") return null;
  if (node.first.type === "leaf" && node.first.paneId === leafId) {
    return { parent: node, sibling: node.second };
  }
  if (node.second.type === "leaf" && node.second.paneId === leafId) {
    return { parent: node, sibling: node.first };
  }
  return findParentSplit(node.first, leafId) || findParentSplit(node.second, leafId);
}

describe("split tree: findLeaf", () => {
  it("finds leaf in a single-node tree", () => {
    const tree = leaf(1);
    expect(findLeaf(tree, 1)).toEqual(leaf(1));
  });

  it("returns null for missing id", () => {
    const tree = leaf(1);
    expect(findLeaf(tree, 99)).toBeNull();
  });

  it("finds leaf in left branch of split", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    expect(findLeaf(tree, 1)).toEqual(leaf(1));
  });

  it("finds leaf in right branch of split", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    expect(findLeaf(tree, 2)).toEqual(leaf(2));
  });

  it("finds leaf in deeply nested tree", () => {
    const tree = split(
      "vertical",
      split("horizontal", leaf(1), leaf(2)),
      split("horizontal", leaf(3), leaf(4)),
    );
    expect(findLeaf(tree, 3)).toEqual(leaf(3));
    expect(findLeaf(tree, 4)).toEqual(leaf(4));
  });
});

describe("split tree: findFirstLeaf", () => {
  it("returns the leaf for a single-node tree", () => {
    expect(findFirstLeaf(leaf(5))).toEqual(leaf(5));
  });

  it("returns leftmost leaf in a split", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    expect(findFirstLeaf(tree)!.paneId).toBe(1);
  });

  it("returns deepest-leftmost leaf in nested splits", () => {
    const tree = split(
      "vertical",
      split("horizontal", leaf(3), leaf(4)),
      leaf(5),
    );
    expect(findFirstLeaf(tree)!.paneId).toBe(3);
  });
});

describe("split tree: collectLeaves", () => {
  it("returns single leaf", () => {
    expect(collectLeaves(leaf(1))).toEqual([leaf(1)]);
  });

  it("returns all leaves in order", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    const ids = collectLeaves(tree).map((l) => l.paneId);
    expect(ids).toEqual([1, 2]);
  });

  it("returns all leaves in deeply nested tree (left-to-right)", () => {
    const tree = split(
      "vertical",
      split("horizontal", leaf(1), leaf(2)),
      split("horizontal", leaf(3), leaf(4)),
    );
    const ids = collectLeaves(tree).map((l) => l.paneId);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("handles asymmetric trees", () => {
    const tree = split(
      "vertical",
      leaf(1),
      split("horizontal", leaf(2), split("vertical", leaf(3), leaf(4))),
    );
    const ids = collectLeaves(tree).map((l) => l.paneId);
    expect(ids).toEqual([1, 2, 3, 4]);
  });
});

describe("split tree: countLeaves", () => {
  it("single leaf = 1", () => {
    expect(countLeaves(leaf(1))).toBe(1);
  });

  it("one split = 2", () => {
    expect(countLeaves(split("vertical", leaf(1), leaf(2)))).toBe(2);
  });

  it("nested splits count correctly", () => {
    const tree = split(
      "vertical",
      split("horizontal", leaf(1), leaf(2)),
      split("horizontal", leaf(3), leaf(4)),
    );
    expect(countLeaves(tree)).toBe(4);
  });
});

describe("split tree: findParentSplit", () => {
  it("returns null for single leaf (no parent)", () => {
    expect(findParentSplit(leaf(1), 1)).toBeNull();
  });

  it("finds parent and sibling for left child", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    const result = findParentSplit(tree, 1);
    expect(result).not.toBeNull();
    expect(result!.sibling).toEqual(leaf(2));
  });

  it("finds parent and sibling for right child", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    const result = findParentSplit(tree, 2);
    expect(result).not.toBeNull();
    expect(result!.sibling).toEqual(leaf(1));
  });

  it("finds parent in nested tree", () => {
    const inner = split("horizontal", leaf(3), leaf(4));
    const tree = split("vertical", leaf(1), inner);
    const result = findParentSplit(tree, 3);
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(inner);
    expect(result!.sibling).toEqual(leaf(4));
  });

  it("returns null for non-existent id", () => {
    const tree = split("vertical", leaf(1), leaf(2));
    expect(findParentSplit(tree, 99)).toBeNull();
  });
});

describe("split tree: focus cycling", () => {
  function focusCycle(leaves: LeafNode[], currentId: number, forward: boolean): number {
    const idx = leaves.findIndex((l) => l.paneId === currentId);
    if (idx === -1) return currentId;
    const next = forward
      ? leaves[(idx + 1) % leaves.length]
      : leaves[(idx - 1 + leaves.length) % leaves.length];
    return next.paneId;
  }

  it("cycles forward through leaves", () => {
    const leaves = [leaf(1), leaf(2), leaf(3)];
    expect(focusCycle(leaves, 1, true)).toBe(2);
    expect(focusCycle(leaves, 2, true)).toBe(3);
    expect(focusCycle(leaves, 3, true)).toBe(1); // wraps
  });

  it("cycles backward through leaves", () => {
    const leaves = [leaf(1), leaf(2), leaf(3)];
    expect(focusCycle(leaves, 3, false)).toBe(2);
    expect(focusCycle(leaves, 2, false)).toBe(1);
    expect(focusCycle(leaves, 1, false)).toBe(3); // wraps
  });

  it("handles single leaf (stays on same)", () => {
    const leaves = [leaf(1)];
    expect(focusCycle(leaves, 1, true)).toBe(1);
    expect(focusCycle(leaves, 1, false)).toBe(1);
  });
});

// NOTE: the Cmd+W dispatch (closeActiveOrTab) behavior lives in tabs.test.ts
// as a real DOM integration test. A previous iteration of this file tested a
// re-implementation of the dispatch decision as a pure function, which gave
// false confidence — it never touched the real pane tree, session.dispose(),
// or DOM, so it couldn't catch the double-fire-cascade bug that motivated
// this file's rewrite.
