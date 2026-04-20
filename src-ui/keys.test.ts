import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the shortcut matching logic in isolation.
// Since keys.ts has side effects (imports tabs, launcher), we extract
// the matching logic and test it directly.

interface Shortcut {
  key: string;
  meta?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  action: () => void;
}

function matchShortcut(
  shortcuts: Shortcut[],
  e: Partial<KeyboardEvent>,
): Shortcut | undefined {
  return shortcuts.find((s) => {
    if (s.key !== e.key) return false;
    if (s.meta && !e.metaKey) return false;
    if (!s.meta && e.metaKey) return false;
    if (s.shift && !e.shiftKey) return false;
    if (!s.shift && e.shiftKey) return false;
    if (s.ctrl && !e.ctrlKey) return false;
    if (!s.ctrl && e.ctrlKey) return false;
    return true;
  });
}

function makeEvent(overrides: Partial<KeyboardEvent>): Partial<KeyboardEvent> {
  return {
    key: "",
    metaKey: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("shortcut matching", () => {
  const action = vi.fn();

  const shortcuts: Shortcut[] = [
    { key: "t", meta: true, action },
    { key: "w", meta: true, shift: true, action },
    { key: "d", meta: true, action },
    { key: "d", meta: true, shift: true, action },
    { key: "w", meta: true, action },
    { key: "q", meta: true, action },
    { key: "]", meta: true, action },
    { key: "[", meta: true, action },
    { key: "ArrowUp", meta: true, action },
    { key: "ArrowDown", meta: true, action },
    { key: "1", meta: true, action },
  ];

  it("matches Cmd+T", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "t", metaKey: true }));
    expect(result).toBeDefined();
    expect(result!.key).toBe("t");
    expect(result!.meta).toBe(true);
  });

  it("matches Cmd+D (split vertical)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "d", metaKey: true }));
    expect(result).toBeDefined();
    expect(result!.key).toBe("d");
    expect(result!.shift).toBeUndefined();
  });

  it("matches Cmd+Shift+D (split horizontal)", () => {
    const result = matchShortcut(
      shortcuts,
      makeEvent({ key: "d", metaKey: true, shiftKey: true }),
    );
    expect(result).toBeDefined();
    expect(result!.key).toBe("d");
    expect(result!.shift).toBe(true);
  });

  it("matches Cmd+Shift+W (close tab, not close pane)", () => {
    const result = matchShortcut(
      shortcuts,
      makeEvent({ key: "w", metaKey: true, shiftKey: true }),
    );
    expect(result).toBeDefined();
    expect(result!.shift).toBe(true);
  });

  it("matches Cmd+W (close pane)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "w", metaKey: true }));
    expect(result).toBeDefined();
    expect(result!.key).toBe("w");
    expect(result!.shift).toBeUndefined();
  });

  it("matches Cmd+Q (quit)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "q", metaKey: true }));
    expect(result).toBeDefined();
    expect(result!.key).toBe("q");
  });

  it("matches Cmd+] (next tab)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "]", metaKey: true }));
    expect(result).toBeDefined();
  });

  it("matches Cmd+[ (prev tab)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "[", metaKey: true }));
    expect(result).toBeDefined();
  });

  it("matches Cmd+ArrowUp (focus pane)", () => {
    const result = matchShortcut(
      shortcuts,
      makeEvent({ key: "ArrowUp", metaKey: true }),
    );
    expect(result).toBeDefined();
  });

  it("matches Cmd+1 (switch tab)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "1", metaKey: true }));
    expect(result).toBeDefined();
  });

  it("does NOT match plain 't' (no meta)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "t" }));
    expect(result).toBeUndefined();
  });

  it("does NOT match Cmd+X (unregistered)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "x", metaKey: true }));
    expect(result).toBeUndefined();
  });

  it("does NOT match Ctrl+T (wrong modifier)", () => {
    const result = matchShortcut(shortcuts, makeEvent({ key: "t", ctrlKey: true }));
    expect(result).toBeUndefined();
  });

  it("does NOT match Cmd+Shift+T (shift not expected)", () => {
    const result = matchShortcut(
      shortcuts,
      makeEvent({ key: "t", metaKey: true, shiftKey: true }),
    );
    expect(result).toBeUndefined();
  });

  it("does NOT match plain letters (should pass through to terminal)", () => {
    for (const key of ["a", "b", "c", "z", "Enter", "Escape", " "]) {
      const result = matchShortcut(shortcuts, makeEvent({ key }));
      expect(result).toBeUndefined();
    }
  });
});
