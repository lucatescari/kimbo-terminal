import { describe, it, expect } from "vitest";
import { classifyTitle, CODEX_SPINNER_FRAMES } from "./title-activity";

describe("classifyTitle: codex's braille spinner", () => {
  it("reads a spinner frame as work in progress and takes it off the title", () => {
    expect(classifyTitle("⠋ codex")).toEqual({ title: "codex", busy: true });
  });

  it("recognises every frame codex cycles through", () => {
    // codex 0.153.4 ships the ten-frame dots spinner; a tab must not blink
    // its dot off on whichever frames we forgot.
    expect(CODEX_SPINNER_FRAMES).toHaveLength(10);
    for (const frame of CODEX_SPINNER_FRAMES) {
      expect(classifyTitle(`${frame} codex`)).toEqual({ title: "codex", busy: true });
    }
  });
});

describe("classifyTitle: Claude Code's own glyphs", () => {
  it("strips them without claiming the tab is busy", () => {
    // The activity poll owns Claude's dot, and it knows the difference
    // between working and waiting for you. Inferring `busy` from the title
    // as well would fight it every 2s.
    for (const title of ["◐ my-project", "◑ my-project", "✳ my-project"]) {
      expect(classifyTitle(title)).toEqual({ title: "my-project", busy: false });
    }
  });
});

describe("classifyTitle: everything else is left alone", () => {
  it("passes an ordinary title through untouched", () => {
    expect(classifyTitle("my-project")).toEqual({ title: "my-project", busy: false });
  });

  it("ignores a glyph that is not followed by a space", () => {
    expect(classifyTitle("⠋codex")).toEqual({ title: "⠋codex", busy: false });
  });

  it("ignores a glyph that is not at the start", () => {
    expect(classifyTitle("build ⠋ running")).toEqual({ title: "build ⠋ running", busy: false });
  });

  it("leaves another program's spinner vocabulary alone", () => {
    // Deliberately narrow: only the two sets we have actually confirmed.
    expect(classifyTitle("| building")).toEqual({ title: "| building", busy: false });
    expect(classifyTitle("◴ waiting")).toEqual({ title: "◴ waiting", busy: false });
  });

  it("handles an empty title and a glyph-only title", () => {
    expect(classifyTitle("")).toEqual({ title: "", busy: false });
    expect(classifyTitle("⠋ ")).toEqual({ title: "", busy: true });
  });
});
