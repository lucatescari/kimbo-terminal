/**
 * POSIX shell single-quote a path so it survives any characters (spaces,
 * quotes, `$`, globs). Internal `'` becomes `'\''`.
 */
export function quotePath(p: string): string {
  return "'" + p.replace(/'/g, "'\\''") + "'";
}

/** Quote each path and join with single spaces. No trailing newline. */
export function joinPathsForPaste(paths: string[]): string {
  return paths.map(quotePath).join(" ");
}

/**
 * Given the element returned by `document.elementFromPoint` and the currently
 * active paneId, return the paneId that should receive the drop.
 *
 * Climbs ancestors looking for `.pane[data-pane-id]`. If nothing matches,
 * returns `activePaneId` — unless that is `-1` (no active pane), in which
 * case returns `null` and the caller should ignore the event.
 */
export function resolveTargetPaneId(
  hit: Element | null,
  activePaneId: number,
): number | null {
  let cur: Element | null = hit;
  while (cur) {
    if (cur instanceof HTMLElement && cur.classList.contains("pane")) {
      const raw = cur.dataset.paneId;
      if (raw != null) {
        const id = Number(raw);
        if (!Number.isNaN(id)) return id;
      }
    }
    cur = cur.parentElement;
  }
  return activePaneId === -1 ? null : activePaneId;
}

import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  findPaneIdAtPoint,
  getActivePaneId,
  getSessionByPaneId,
  setActivePane,
} from "./panes";

const HINT_CLASS = "pane-drop-hint";
const TARGET_CLASS = "drop-target";

let currentTargetId: number | null = null;
let hintEl: HTMLElement | null = null;
let unlisten: UnlistenFn | null = null;
// Tauri's "over" events don't carry paths — cache the count from "enter".
let pendingPathCount = 0;

function ensureHint(): HTMLElement {
  if (hintEl) return hintEl;
  const el = document.createElement("div");
  el.className = HINT_CLASS;
  hintEl = el;
  return el;
}

function clearTarget() {
  if (currentTargetId == null) return;
  const session = getSessionByPaneId(currentTargetId);
  // session.container is a direct child of the .pane element (see createLeaf in panes.ts).
  const paneEl = session?.container.parentElement ?? null;
  if (paneEl) paneEl.classList.remove(TARGET_CLASS);
  if (hintEl && hintEl.parentElement) hintEl.parentElement.removeChild(hintEl);
  currentTargetId = null;
}

function setTarget(paneId: number, pathCount: number) {
  if (currentTargetId === paneId) {
    // Same pane — just refresh the count text.
    if (hintEl) hintEl.textContent = hintText(pathCount);
    return;
  }
  clearTarget();
  const session = getSessionByPaneId(paneId);
  // session.container is a direct child of the .pane element (see createLeaf in panes.ts).
  const paneEl = session?.container.parentElement ?? null;
  if (!paneEl) return;
  paneEl.classList.add(TARGET_CLASS);
  const hint = ensureHint();
  hint.textContent = hintText(pathCount);
  paneEl.appendChild(hint);
  currentTargetId = paneId;
}

function hintText(n: number): string {
  return `📎 Drop to paste ${n} path${n === 1 ? "" : "s"}`;
}

function resolvePaneIdFromPosition(x: number, y: number): number | null {
  const dpr = window.devicePixelRatio || 1;
  // Tauri v2 reports position in physical pixels; elementFromPoint wants CSS px.
  const cssX = x / dpr;
  const cssY = y / dpr;
  const hit = findPaneIdAtPoint(cssX, cssY);
  if (hit != null) return hit;
  const active = getActivePaneId();
  return active === -1 ? null : active;
}

export async function initDragDrop(): Promise<void> {
  if (unlisten) return; // Already initialised.
  const webview = getCurrentWebview();
  unlisten = await webview.onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter") {
      if (p.paths.length === 0) return;
      pendingPathCount = p.paths.length;
      const paneId = resolvePaneIdFromPosition(p.position.x, p.position.y);
      if (paneId == null) { clearTarget(); return; }
      setTarget(paneId, pendingPathCount);
      return;
    }
    if (p.type === "over") {
      const paneId = resolvePaneIdFromPosition(p.position.x, p.position.y);
      if (paneId == null) { clearTarget(); return; }
      setTarget(paneId, pendingPathCount);
      return;
    }
    if (p.type === "leave") {
      clearTarget();
      pendingPathCount = 0;
      return;
    }
    // type === "drop"
    const paneId = resolvePaneIdFromPosition(p.position.x, p.position.y);
    clearTarget();
    pendingPathCount = 0;
    if (paneId == null || p.paths.length === 0) return;
    const session = getSessionByPaneId(paneId);
    if (!session) return;
    const payload = joinPathsForPaste(p.paths);
    // Use term.paste so xterm.js wraps the payload in bracketed-paste markers
    // when the running program has enabled DEC mode 2004 (e.g. Claude Code).
    // That lets the program detect pasted image paths and render them as
    // attachments instead of treating them as typed characters.
    session.term.paste(payload);
    setActivePane(paneId);
  });
}

/** Test/teardown helper. Not called in production. */
export function __disposeDragDrop() {
  if (unlisten) { unlisten(); unlisten = null; }
  clearTarget();
  pendingPathCount = 0;
  hintEl = null;
}
