import { describe, it, expect } from "vitest";
import { choosePathAction } from "./file-path-action";

describe("choosePathAction", () => {
  it("opens on Cmd+click (meta, no shift)", () => {
    expect(choosePathAction({ metaKey: true, shiftKey: false })).toBe("open");
  });

  it("reveals on Cmd+Shift+click (meta + shift)", () => {
    expect(choosePathAction({ metaKey: true, shiftKey: true })).toBe("reveal");
  });

  it("does nothing without Cmd", () => {
    expect(choosePathAction({ metaKey: false, shiftKey: false })).toBe("none");
    expect(choosePathAction({ metaKey: false, shiftKey: true })).toBe("none");
  });
});
