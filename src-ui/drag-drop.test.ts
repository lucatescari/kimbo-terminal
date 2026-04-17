import { describe, it, expect } from "vitest";
import { quotePath, joinPathsForPaste } from "./drag-drop";

describe("quotePath", () => {
  it("wraps a simple path in single quotes", () => {
    expect(quotePath("/tmp/foo.png")).toBe("'/tmp/foo.png'");
  });

  it("preserves spaces inside the quotes", () => {
    expect(quotePath("/tmp/my file.png")).toBe("'/tmp/my file.png'");
  });

  it("escapes internal single quotes using the ' \"'\\''\" trick", () => {
    // foo's.png -> 'foo'\''s.png'
    expect(quotePath("foo's.png")).toBe("'foo'\\''s.png'");
  });

  it("handles multiple single quotes", () => {
    expect(quotePath("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it("quotes the empty string as ''", () => {
    expect(quotePath("")).toBe("''");
  });

  it("leaves unicode characters alone", () => {
    expect(quotePath("/tmp/日本語.png")).toBe("'/tmp/日本語.png'");
  });
});

describe("joinPathsForPaste", () => {
  it("returns an empty string for zero paths", () => {
    expect(joinPathsForPaste([])).toBe("");
  });

  it("quotes a single path", () => {
    expect(joinPathsForPaste(["/tmp/a.png"])).toBe("'/tmp/a.png'");
  });

  it("quotes and space-joins multiple paths", () => {
    expect(joinPathsForPaste(["/tmp/a.png", "/tmp/b c.png"])).toBe(
      "'/tmp/a.png' '/tmp/b c.png'",
    );
  });

  it("does not append a trailing newline", () => {
    const out = joinPathsForPaste(["/tmp/a.png"]);
    expect(out.endsWith("\n")).toBe(false);
  });
});

import { resolveTargetPaneId } from "./drag-drop";

describe("resolveTargetPaneId", () => {
  function makePaneChain(paneId: number): HTMLElement {
    // Build: <div class="pane" data-pane-id=...><div><span>leaf</span></div></div>
    // Return the innermost leaf so resolveTargetPaneId has to climb.
    const pane = document.createElement("div");
    pane.className = "pane";
    pane.dataset.paneId = String(paneId);
    const mid = document.createElement("div");
    const leaf = document.createElement("span");
    mid.appendChild(leaf);
    pane.appendChild(mid);
    document.body.appendChild(pane);
    return leaf;
  }

  it("returns the paneId of the pane ancestor of the hit element", () => {
    const leaf = makePaneChain(7);
    expect(resolveTargetPaneId(leaf, 3)).toBe(7);
  });

  it("falls back to the active paneId when the hit element has no pane ancestor", () => {
    const orphan = document.createElement("div");
    document.body.appendChild(orphan);
    expect(resolveTargetPaneId(orphan, 42)).toBe(42);
  });

  it("falls back to the active paneId when the hit is null", () => {
    expect(resolveTargetPaneId(null, 5)).toBe(5);
  });

  it("returns null if there is no hit and no active pane (-1)", () => {
    expect(resolveTargetPaneId(null, -1)).toBeNull();
  });
});
