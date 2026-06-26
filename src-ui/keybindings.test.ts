// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  ACTIONS,
  chordFromEvent,
  chordToDisplayParts,
  isValidChord,
  loadOverrides,
  activeChord,
  actionForChord,
  overrides,
  setOverride,
  resetOverrides,
  isMenuAction,
} from "./keybindings";

function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent;
}

beforeEach(() => resetOverrides());

describe("chordFromEvent", () => {
  it("requires Cmd — returns null without metaKey", () => {
    expect(chordFromEvent(ev({ key: "t" }))).toBeNull();
    expect(chordFromEvent(ev({ key: "t", ctrlKey: true }))).toBeNull();
  });

  it("builds cmd-<key> for a plain Cmd chord", () => {
    expect(chordFromEvent(ev({ key: "t", metaKey: true }))).toBe("cmd-t");
  });

  it("lowercases letters and orders modifiers cmd-ctrl-alt-shift", () => {
    // Shift produces an uppercase key; normalize to lowercase.
    expect(chordFromEvent(ev({ key: "D", metaKey: true, shiftKey: true }))).toBe("cmd-shift-d");
    expect(chordFromEvent(ev({ key: "k", metaKey: true, altKey: true }))).toBe("cmd-alt-k");
  });

  it("normalizes arrows", () => {
    expect(chordFromEvent(ev({ key: "ArrowUp", metaKey: true }))).toBe("cmd-up");
    expect(chordFromEvent(ev({ key: "ArrowRight", metaKey: true }))).toBe("cmd-right");
  });

  it("keeps punctuation keys verbatim", () => {
    expect(chordFromEvent(ev({ key: "]", metaKey: true }))).toBe("cmd-]");
    expect(chordFromEvent(ev({ key: ",", metaKey: true }))).toBe("cmd-,");
  });

  it("returns null for a modifier-only press", () => {
    expect(chordFromEvent(ev({ key: "Meta", metaKey: true }))).toBeNull();
    expect(chordFromEvent(ev({ key: "Shift", metaKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("chordToDisplayParts", () => {
  it("maps modifiers and keys to symbols", () => {
    expect(chordToDisplayParts("cmd-shift-d")).toEqual(["⌘", "⇧", "D"]);
    expect(chordToDisplayParts("cmd-up")).toEqual(["⌘", "↑"]);
    expect(chordToDisplayParts("cmd-]")).toEqual(["⌘", "]"]);
  });
});

describe("isValidChord", () => {
  it("requires cmd and a real (non-modifier) key", () => {
    expect(isValidChord("cmd-t")).toBe(true);
    expect(isValidChord("cmd-shift-d")).toBe(true);
    expect(isValidChord("shift-t")).toBe(false); // no cmd
    expect(isValidChord("cmd-shift")).toBe(false); // no key
  });
});

describe("ACTIONS registry", () => {
  it("has unique ids and valid default chords", () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACTIONS) expect(isValidChord(a.defaultChord), `${a.id}=${a.defaultChord}`).toBe(true);
  });

  it("has no duplicate default chords", () => {
    const chords = ACTIONS.map((a) => a.defaultChord);
    expect(new Set(chords).size).toBe(chords.length);
  });
});

describe("overrides", () => {
  it("activeChord is the override when set, else the default", () => {
    const a = ACTIONS[0];
    expect(activeChord(a.id)).toBe(a.defaultChord);
    setOverride(a.id, "cmd-alt-z");
    expect(activeChord(a.id)).toBe("cmd-alt-z");
    expect(overrides()[a.id]).toBe("cmd-alt-z");
  });

  it("loadOverrides replaces the override set and ignores unknown ids", () => {
    const id = ACTIONS[0].id;
    loadOverrides({ [id]: "cmd-alt-z", not_a_real_action: "cmd-x" });
    expect(activeChord(id)).toBe("cmd-alt-z");
    expect(overrides().not_a_real_action).toBeUndefined();
  });

  it("resetOverrides restores all defaults", () => {
    setOverride(ACTIONS[0].id, "cmd-alt-z");
    resetOverrides();
    expect(overrides()).toEqual({});
    expect(activeChord(ACTIONS[0].id)).toBe(ACTIONS[0].defaultChord);
  });
});

describe("new_window action", () => {
  it("activeChord('new_window') is cmd-n by default", () => {
    expect(activeChord("new_window")).toBe("cmd-n");
  });

  it("isMenuAction('new_window') is true — keystroke is owned by the native menu, not the webview", () => {
    expect(isMenuAction("new_window")).toBe(true);
  });
});

describe("prompt-jump default chords", () => {
  it("jump_prev_prompt is bound to cmd-shift-up by default", () => {
    expect(activeChord("jump_prev_prompt")).toBe("cmd-shift-up");
  });

  it("jump_next_prompt is bound to cmd-shift-down by default", () => {
    expect(activeChord("jump_next_prompt")).toBe("cmd-shift-down");
  });
});

describe("actionForChord (reverse lookup)", () => {
  it("finds the action bound to a chord, honoring overrides", () => {
    const a = ACTIONS.find((x) => x.id === "new_tab")!;
    expect(actionForChord(a.defaultChord)).toBe("new_tab");
    setOverride("new_tab", "cmd-alt-n");
    expect(actionForChord("cmd-alt-n")).toBe("new_tab");
    expect(actionForChord(a.defaultChord)).toBeUndefined(); // old chord freed
  });

  it("returns undefined for an unbound chord", () => {
    expect(actionForChord("cmd-alt-q")).toBeUndefined();
  });
});
