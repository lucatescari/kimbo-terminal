type SplitAxis = "vertical" | "horizontal";

const MIN_PANE_PX = 80;

/**
 * Make a `.split-handle` div draggable so the user can resize the two sibling
 * panes inside its parent `.pane-container`.
 *
 * Why it has to exist: the handle has had `cursor: col-resize`/`row-resize` in
 * CSS since pane splitting was first added, but no JS listener was ever wired
 * up. The cursor implied the divider was draggable; it wasn't.
 *
 * Sizing model: the children of a `.pane-container` start with `flex: 1`
 * (equal split). On drag, we switch the FIRST sibling to a fixed basis
 * (`flex: 0 0 Npx`) and leave the second sibling at `flex: 1`, so the second
 * pane absorbs any leftover space. Subsequent splits re-create child elements
 * with `flex: 1`, so a re-split resets sizing — acceptable trade-off.
 */
export function attachSplitHandleDrag(
  handle: HTMLElement,
  axis: SplitAxis,
  onResize?: () => void,
): void {
  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;

    const splitEl = handle.parentElement;
    const first = handle.previousElementSibling as HTMLElement | null;
    if (!splitEl || !first) return;

    const containerRect = splitEl.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();

    const startCoord = axis === "vertical" ? e.clientX : e.clientY;
    const startBasis = axis === "vertical" ? firstRect.width : firstRect.height;
    const containerSize = axis === "vertical" ? containerRect.width : containerRect.height;
    const handleSize = axis === "vertical" ? handle.offsetWidth : handle.offsetHeight;
    const maxBasis = Math.max(MIN_PANE_PX, containerSize - handleSize - MIN_PANE_PX);

    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* jsdom / unsupported */ }

    const onMove = (ev: PointerEvent) => {
      const cur = axis === "vertical" ? ev.clientX : ev.clientY;
      const delta = cur - startCoord;
      const basis = Math.max(MIN_PANE_PX, Math.min(maxBasis, startBasis + delta));
      first.style.flex = `0 0 ${Math.round(basis)}px`;
      onResize?.();
    };

    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* see above */ }
      onResize?.();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);

    e.preventDefault();
  });
}
