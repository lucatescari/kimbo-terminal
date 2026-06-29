// Decide what a click on a detected file-path link should do, from the mouse
// modifiers. Pure (no xterm / Tauri deps) so the branch logic is unit-testable.
// Cmd+Shift reveals in Finder; Cmd alone opens in the OS default app for the
// file type; anything without Cmd is ignored (leaves normal text selection).
export type PathAction = "open" | "reveal" | "none";

export function choosePathAction(event: {
  metaKey: boolean;
  shiftKey: boolean;
}): PathAction {
  if (!event.metaKey) return "none";
  return event.shiftKey ? "reveal" : "open";
}
