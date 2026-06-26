import { getActiveSession } from "./panes";
import { showToast } from "./toast";
import { isKimboShellIntegrationEnabled } from "./kimbo";

let shownIntegrationHint = false;

/** Pure selection logic: given sorted-ascending marker lines, the current
 *  viewport top line, and a direction, return the line to scroll to (or null). */
export function pickTargetMarkerLine(
  lines: number[],
  viewportTop: number,
  dir: "prev" | "next",
): number | null {
  if (lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => a - b);
  if (dir === "prev") {
    const above = sorted.filter((l) => l < viewportTop);
    return above.length ? above[above.length - 1] : sorted[0];
  } else {
    const below = sorted.filter((l) => l > viewportTop);
    return below.length ? below[0] : sorted[sorted.length - 1];
  }
}

function jump(dir: "prev" | "next"): void {
  const session = getActiveSession();
  if (!session) return;
  if (!isKimboShellIntegrationEnabled()) {
    if (!shownIntegrationHint) {
      shownIntegrationHint = true;
      showToast({
        message: "Jump-to-prompt needs shell integration",
        detail: "Enable Kimbo shell integration in Settings to use prompt jumps.",
        kind: "info",
        durationMs: 4000,
      });
    }
    return;
  }
  const term = session.term;
  const markers = (session.promptMarkers ?? []).filter((m) => !m.isDisposed);
  session.promptMarkers = markers;
  const lines = markers.map((m) => m.line);
  const viewportTop = term.buffer.active.viewportY;
  const target = pickTargetMarkerLine(lines, viewportTop, dir);
  if (target == null) return;
  term.scrollToLine(target);
}

export function jumpToPrevPrompt(): void { jump("prev"); }
export function jumpToNextPrompt(): void { jump("next"); }
