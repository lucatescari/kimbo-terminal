import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// A tag or branch is a mutable pointer: whoever controls the action's repo can
// move `v4` or `stable` to different code, and CI would run it with whatever
// secrets and write access the job carries. A full commit SHA is immutable, so
// an upgrade becomes a visible diff rather than something that happens between
// two runs of the same workflow file.
//
// This test reads the workflow directly, so it also catches a new step added
// later with an unpinned action.
const workflow = readFileSync(
  resolve(__dirname, "../.github/workflows/ci.yml"),
  "utf-8",
);

/** Every `uses:` reference in the workflow, with its line number. */
function usesReferences(): Array<{ line: number; ref: string }> {
  return workflow
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => /^\s*-?\s*uses:\s*\S/.test(text))
    .map(({ line, text }) => ({
      line,
      ref: text.replace(/^\s*-?\s*uses:\s*/, "").split("#")[0].trim(),
    }));
}

describe("CI workflow action pinning", () => {
  it("finds the action references it is meant to guard", () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuously true.
    expect(usesReferences().length).toBeGreaterThan(0);
  });

  it("pins every action to a full 40-character commit SHA", () => {
    const unpinned = usesReferences().filter(
      ({ ref }) => !/@[0-9a-f]{40}$/.test(ref),
    );

    expect(
      unpinned.map(({ line, ref }) => `ci.yml:${line} ${ref}`),
      "actions must be pinned to a commit SHA, not a tag or branch",
    ).toEqual([]);
  });

  it("keeps a human-readable version comment next to each pin", () => {
    // A bare SHA says nothing about what version is running, which makes the
    // workflow unreviewable and upgrades easy to put off forever.
    const uncommented = workflow
      .split("\n")
      .map((text, i) => ({ line: i + 1, text }))
      .filter(({ text }) => /^\s*-?\s*uses:\s*\S/.test(text))
      .filter(({ text }) => !/#\s*\S/.test(text));

    expect(
      uncommented.map(({ line, text }) => `ci.yml:${line} ${text.trim()}`),
      "each pinned action needs a trailing comment naming its version",
    ).toEqual([]);
  });
});
