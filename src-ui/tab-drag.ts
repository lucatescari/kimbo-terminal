import { reorderTab } from "./tabs";

const DRAG_THRESHOLD = 5;
const AUTO_SCROLL_ZONE = 40;
const AUTO_SCROLL_MAX_SPEED = 8;

interface DragState {
  tabEl: HTMLElement;
  tabIndex: number;
  startX: number;
  offsetX: number;
  currentIndex: number;
  scrollRegion: HTMLElement;
  tabEls: HTMLElement[];
  tabWidths: number[];
  tabMidpoints: number[];
  active: boolean;
  autoScrollRaf: number | null;
}

let drag: DragState | null = null;
let justFinishedDrag = false;

export function initTabDrag(tabBarEl: HTMLElement) {
  tabBarEl.addEventListener("pointerdown", onPointerDown);
}

export function cancelDrag() {
  if (!drag) return;
  const { tabEl, tabEls, autoScrollRaf } = drag;
  if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf);
  tabEl.classList.remove("dragging");
  tabEl.style.transform = "";
  for (const t of tabEls) {
    t.classList.remove("drag-shifting");
    t.style.transform = "";
  }
  tabEl.removeEventListener("pointermove", onPointerMove);
  tabEl.removeEventListener("pointerup", onPointerUp);
  tabEl.removeEventListener("pointercancel", onPointerUp);
  drag = null;
}



export function wasJustDragging(): boolean {
  return justFinishedDrag;
}

function onPointerDown(e: PointerEvent) {
  const tabEl = (e.target as HTMLElement).closest(".tab") as HTMLElement | null;
  if (!tabEl) return;

  // Don't drag if clicking the close button
  if ((e.target as HTMLElement).closest(".tab-close")) return;

  const scrollRegion = tabEl.closest(".tab-scroll-region") as HTMLElement | null;
  if (!scrollRegion) return;

  const tabEls = Array.from(scrollRegion.querySelectorAll(".tab")) as HTMLElement[];
  if (tabEls.length < 2) return;

  const tabIndex = tabEls.indexOf(tabEl);
  if (tabIndex === -1) return;

  const rect = tabEl.getBoundingClientRect();

  drag = {
    tabEl,
    tabIndex,
    startX: e.clientX,
    offsetX: e.clientX - rect.left,
    currentIndex: tabIndex,
    scrollRegion,
    tabEls,
    tabWidths: tabEls.map((t) => t.getBoundingClientRect().width),
    tabMidpoints: tabEls.map((t) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2;
    }),
    active: false,
    autoScrollRaf: null,
  };

  tabEl.addEventListener("pointermove", onPointerMove);
  tabEl.addEventListener("pointerup", onPointerUp);
  tabEl.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return;

  const dx = e.clientX - drag.startX;

  if (!drag.active) {
    if (Math.abs(dx) < DRAG_THRESHOLD) return;
    drag.active = true;
    try { drag.tabEl.setPointerCapture(e.pointerId); } catch (_) {}
    drag.tabEl.classList.add("dragging");
  }

  drag.tabEl.style.transform = `translateX(${dx}px) scale(1.04)`;

  // Determine where the cursor is relative to other tab midpoints
  const cursorX = e.clientX;
  let newIndex = drag.tabIndex;
  for (let i = 0; i < drag.tabMidpoints.length; i++) {
    if (i === drag.tabIndex) continue;
    if (i < drag.tabIndex && cursorX < drag.tabMidpoints[i]) {
      newIndex = Math.min(newIndex, i);
    } else if (i > drag.tabIndex && cursorX > drag.tabMidpoints[i]) {
      newIndex = Math.max(newIndex, i);
    }
  }

  if (newIndex !== drag.currentIndex) {
    drag.currentIndex = newIndex;
    applyShifts();
  }

  autoScroll(e.clientX);
}

function applyShifts() {
  if (!drag) return;
  const { tabEls, tabIndex, currentIndex, tabWidths } = drag;

  for (let i = 0; i < tabEls.length; i++) {
    if (i === tabIndex) continue;
    const el = tabEls[i];
    el.classList.add("drag-shifting");
    let shift = 0;

    if (tabIndex < currentIndex) {
      // Dragging right: tabs between original and target shift left
      if (i > tabIndex && i <= currentIndex) {
        shift = -(tabWidths[tabIndex] + 2);
      }
    } else if (tabIndex > currentIndex) {
      // Dragging left: tabs between target and original shift right
      if (i >= currentIndex && i < tabIndex) {
        shift = tabWidths[tabIndex] + 2;
      }
    }

    el.style.transform = shift ? `translateX(${shift}px)` : "";
  }
}

function autoScroll(clientX: number) {
  if (!drag) return;

  const regionRect = drag.scrollRegion.getBoundingClientRect();
  const distLeft = clientX - regionRect.left;
  const distRight = regionRect.right - clientX;

  let speed = 0;
  if (distLeft < AUTO_SCROLL_ZONE && distLeft >= 0) {
    speed = -AUTO_SCROLL_MAX_SPEED * (1 - distLeft / AUTO_SCROLL_ZONE);
  } else if (distRight < AUTO_SCROLL_ZONE && distRight >= 0) {
    speed = AUTO_SCROLL_MAX_SPEED * (1 - distRight / AUTO_SCROLL_ZONE);
  }

  if (drag.autoScrollRaf !== null) {
    cancelAnimationFrame(drag.autoScrollRaf);
    drag.autoScrollRaf = null;
  }

  if (speed !== 0) {
    const scroll = () => {
      if (!drag) return;
      drag.scrollRegion.scrollLeft += speed;
      recalcMidpoints();
      drag.autoScrollRaf = requestAnimationFrame(scroll);
    };
    drag.autoScrollRaf = requestAnimationFrame(scroll);
  }
}

function recalcMidpoints() {
  if (!drag) return;
  drag.tabMidpoints = drag.tabEls.map((t) => {
    const r = t.getBoundingClientRect();
    return r.left + r.width / 2;
  });
}

function onPointerUp(e: PointerEvent) {
  if (!drag) return;

  const { tabEl, tabIndex, currentIndex, tabEls, active, autoScrollRaf } = drag;

  if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf);

  tabEl.removeEventListener("pointermove", onPointerMove);
  tabEl.removeEventListener("pointerup", onPointerUp);
  tabEl.removeEventListener("pointercancel", onPointerUp);

  if (active) {
    try { tabEl.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  // Clear all transforms
  tabEl.classList.remove("dragging");
  tabEl.style.transform = "";
  for (const t of tabEls) {
    t.classList.remove("drag-shifting");
    t.style.transform = "";
  }

  if (active && tabIndex !== currentIndex) {
    reorderTab(tabIndex, currentIndex);
  }

  if (active) {
    justFinishedDrag = true;
    requestAnimationFrame(() => { justFinishedDrag = false; });
  }

  drag = null;
}
