import "./kimbo.css";
import type { Mood } from "./kimbo-state";

export type Corner = "bottom_right" | "bottom_left" | "top_right" | "top_left";
export type OverlayKind = "heart" | "drop" | "zzz" | "sparkleA" | "sparkleB" | "question" | "wave";

const ALL_CORNERS: Corner[] = ["bottom_right", "bottom_left", "top_right", "top_left"];
const ALL_MOODS: Mood[] = [
  "idle", "happy", "love", "sad", "sleepy", "focused", "excited", "curious", "wave",
];

export interface KimboDom {
  mount(): void;
  unmount(): void;
  element(): HTMLElement | null;
  setMood(mood: Mood): void;
  setCorner(corner: Corner): void;
  setHidden(hidden: boolean): void;
  nearestCorner(clientX: number, clientY: number): Corner;
  onClick(cb: () => void): void;
  onContextMenu(cb: (x: number, y: number) => void): void;
  onDragEnd(cb: (corner: Corner) => void): void;
  showOverlay(kind: OverlayKind, durationMs?: number): void;
  showBubble(text: string): void;
}

export function createKimboDom(root: HTMLElement): KimboDom {
  let el: HTMLElement | null = null;
  let currentCorner: Corner = "bottom_right";
  let clickCb: (() => void) | null = null;
  let ctxCb: ((x: number, y: number) => void) | null = null;
  let dragEndCb: ((c: Corner) => void) | null = null;
  let suppressNextClick = false;
  let dragDispose: (() => void) | null = null;

  function mount() {
    if (el) return;
    el = document.createElement("div");
    el.className = `kimbo mood-idle corner-${currentCorner}`;
    el.addEventListener("click", () => {
      if (suppressNextClick) { suppressNextClick = false; return; }
      clickCb?.();
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ctxCb?.(e.clientX, e.clientY);
    });
    dragDispose = attachDrag(el);
    root.appendChild(el);
  }

  function unmount() {
    if (el) {
      dragDispose?.();
      dragDispose = null;
      el.remove();
      el = null;
    }
  }

  function setMood(mood: Mood) {
    if (!el) return;
    for (const m of ALL_MOODS) el.classList.remove(`mood-${m}`);
    el.classList.add(`mood-${mood}`);
  }

  function setCorner(corner: Corner) {
    currentCorner = corner;
    if (!el) return;
    for (const c of ALL_CORNERS) el.classList.remove(`corner-${c}`);
    el.classList.add(`corner-${corner}`);
  }

  function setHidden(hidden: boolean) {
    if (!el) return;
    el.classList.toggle("hidden", hidden);
  }

  function nearestCorner(x: number, y: number): Corner {
    const midX = window.innerWidth / 2;
    const midY = window.innerHeight / 2;
    const top = y < midY;
    const left = x < midX;
    if (top && left) return "top_left";
    if (top && !left) return "top_right";
    if (!top && left) return "bottom_left";
    return "bottom_right";
  }

  function attachDrag(target: HTMLElement): () => void {
    let dragging = false;
    let startX = 0, startY = 0;

    target.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      target.classList.add("dragging");
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || !el) return;
      // Show the element following the cursor by temporarily setting inset overrides.
      el.style.left = `${e.clientX - 28}px`;
      el.style.top = `${e.clientY - 28}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging || !el) return;
      dragging = false;
      el.classList.remove("dragging");
      el.style.left = ""; el.style.top = ""; el.style.right = ""; el.style.bottom = "";

      const moved = Math.hypot(e.clientX - startX, e.clientY - startY) > 4;
      if (moved) {
        const c = nearestCorner(e.clientX, e.clientY);
        setCorner(c);
        suppressNextClick = true;
        // Clear the flag after the click event fires.
        if (typeof queueMicrotask === "function") {
          queueMicrotask(() => { suppressNextClick = false; });
        } else {
          setTimeout(() => { suppressNextClick = false; }, 0);
        }
        dragEndCb?.(c);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }

  function showOverlay(kind: OverlayKind, durationMs = 1600) {
    if (!el) return;
    const ov = document.createElement("span");
    ov.className = `kimbo-overlay ${kind}`;
    ov.textContent = overlayGlyph(kind);
    el.appendChild(ov);
    setTimeout(() => ov.remove(), durationMs);
  }

  function showBubble(text: string) {
    if (!el) return;
    // Replace any existing bubble.
    el.querySelectorAll(".kimbo-bubble").forEach((b) => b.remove());
    const bubble = document.createElement("div");
    bubble.className = "kimbo-bubble";
    bubble.textContent = text;
    el.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2500);
  }

  return {
    mount, unmount,
    element: () => el,
    setMood, setCorner, setHidden, nearestCorner,
    onClick: (cb) => { clickCb = cb; },
    onContextMenu: (cb) => { ctxCb = cb; },
    onDragEnd: (cb) => { dragEndCb = cb; },
    showOverlay, showBubble,
  };
}

function overlayGlyph(kind: OverlayKind): string {
  switch (kind) {
    case "heart":    return "\u2764\ufe0f";
    case "drop":     return "\ud83d\udca7";
    case "zzz":      return "z";
    case "sparkleA": return "\u2728";
    case "sparkleB": return "\u2728";
    case "question": return "?";
    case "wave":     return "\ud83d\udc4b";
  }
}
