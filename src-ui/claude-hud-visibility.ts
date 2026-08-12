// Decide what a HUD poll tick should do with a pane's `.claude-hud` strip.
// Pure (no DOM / Tauri deps) so the branch logic is unit-testable, mirroring
// file-path-action.ts.
//
// The distinction that matters is between "the user turned the HUD off" and
// "this pane's tab is in the background". Both skip the status probe — which
// shells out to `ps` over the whole process table and is why the probe was
// restricted to visible panes in 0.16.1 — but only the former should remove
// the strip.
//
// Removing it for a merely hidden pane changes that pane's layout: .claude-hud
// is 22px and sits between .pane-head and .terminal-container, so the terminal
// grows 22px while the tab is hidden and shrinks again when the strip returns.
// Each change triggers a fit, which changes the row count, which reflows xterm
// and resizes the PTY — the terminal visibly jumps and the scroll position
// shifts every time the tab is reselected.
export type HudAction = "refresh" | "remove" | "skip";

export function chooseHudAction(state: {
  hudEnabled: boolean;
  hidden: boolean;
}): HudAction {
  if (!state.hudEnabled) return "remove";
  return state.hidden ? "skip" : "refresh";
}
