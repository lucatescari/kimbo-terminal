import { describe, it, expect } from "vitest";
import { chooseHudAction } from "./claude-hud-visibility";

describe("chooseHudAction", () => {
  it("refreshes for a visible pane with the HUD enabled", () => {
    expect(chooseHudAction({ hudEnabled: true, hidden: false })).toBe("refresh");
  });

  it("removes the strip when the HUD is turned off", () => {
    expect(chooseHudAction({ hudEnabled: false, hidden: false })).toBe("remove");
  });

  it("removes the strip when the HUD is off even in a hidden tab", () => {
    expect(chooseHudAction({ hudEnabled: false, hidden: true })).toBe("remove");
  });

  // The regression this module exists for. A background tab must skip the
  // ps-based probe (that was the 0.16.1 performance fix) WITHOUT removing the
  // strip: .claude-hud is 22px and sits between .pane-head and
  // .terminal-container, so removing it shrinks the terminal, changes the row
  // count on the next fit, and makes the pane jump when the tab is reselected.
  it("keeps the strip for a hidden pane, skipping only the probe", () => {
    expect(chooseHudAction({ hudEnabled: true, hidden: true })).toBe("skip");
  });
});
