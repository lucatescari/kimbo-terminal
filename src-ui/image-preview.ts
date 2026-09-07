import { invoke } from "@tauri-apps/api/core";
import { decodeBase64Bytes, sniffBitmapFormat } from "./osc1337";

/** Hover preview for image files named in terminal output.
 *
 *  Why a floating popover rather than a real inline image: the inline path
 *  (osc1337-renderer.ts) pins an image to a buffer cell with a marker and a
 *  decoration, and it hides every image while the alternate screen buffer is
 *  active. Full-screen TUIs like Claude Code own every cell, reserve no rows
 *  for a picture, and repaint their own scrolling transcript, so a cell-pinned
 *  image would cover live text and drift on each repaint. A popover owes
 *  nothing to the cell grid, so it works the same in either buffer and leaves
 *  the terminal's own layout untouched.
 *
 *  Bytes come over IPC and render through a blob URL because the app's content
 *  security policy allows only 'self', data: and blob: image sources; there is
 *  no asset protocol to point an <img> at a file on disk.
 *
 *  The popover parents itself to document.body, as every other floating layer
 *  in the app does (dropdown.ts, the context menus, toasts). It has to:
 *  #app-frame carries transform: translateZ(0), which makes it the containing
 *  block for any position:fixed descendant, and the pane and terminal
 *  container both set overflow: hidden. Parented inside the terminal, the
 *  popover would be offset by the frame's origin and clipped to the pane. */

/** Matches the inline renderer's ceiling. A hover has to feel instant, and a
 *  screenshot that large would not decode in time to be worth showing. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Longest side of the thumbnail, and the width assumed while the image has
 *  not laid out yet. Kept in step with the max-width/height in style.css. */
const MAX_EDGE = 360;
/** Gap between the pointer and the popover, and the smallest margin kept
 *  between the popover and the window edge. */
const GAP = 12;
const MARGIN = 8;

/** How long a thumbnail survives a hide before it is actually torn down.
 *  xterm drops the current link and asks the provider again on every repaint
 *  of the hovered row, firing leave and then hover each time; while output
 *  streams that is once a frame. Tearing down at once would re-read the file
 *  over IPC and restart the entrance animation every frame, so the thumbnail
 *  would strobe instead of appearing. The grace period is long enough to
 *  bridge that gap and short enough to feel immediate when the pointer really
 *  has left. */
const HIDE_GRACE_MS = 150;

/** Extensions worth asking the backend for. The real gate is the magic-byte
 *  sniff in osc1337.ts, which is also the set of formats this list mirrors;
 *  the extension check just avoids an IPC round-trip and a file read for every
 *  source file and log the pointer happens to cross. */
const PREVIEWABLE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** Whether a resolved path looks like an image the preview can decode. */
export function isPreviewableImage(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // dot === 0 is a dotfile with no extension of its own (".png"), and -1 is a
  // name with no extension at all.
  if (dot <= 0) return false;
  return PREVIEWABLE.has(name.slice(dot + 1).toLowerCase());
}

export interface ImagePreview {
  /** Fetch and show `path` near a viewport point. Resolves once the popover is
   *  up, or once the attempt has been abandoned. Never rejects. */
  show(path: string, anchor: { x: number; y: number }): Promise<void>;
  /** Take the popover down and cancel any fetch still in flight. */
  hide(): void;
  /** Tear down for good. Safe to call more than once. */
  dispose(): void;
}

export function createImagePreview(): ImagePreview {
  let shown: { el: HTMLElement; url: string; path: string } | null = null;
  let pendingHide: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  /** The path that should be on screen right now, or null for none. A fetch
   *  renders only if this still names its path: anything else means the
   *  pointer has moved on, the keyboard was used, or the pane is gone. */
  let wanted: string | null = null;
  /** The fetch already running, so a repaint storm asking for the same path
   *  over and over joins it instead of starting another. */
  let inFlight: { path: string; done: Promise<void> } | null = null;

  const cancelPendingHide = (): void => {
    if (pendingHide === null) return;
    clearTimeout(pendingHide);
    pendingHide = null;
  };

  const teardown = (): void => {
    cancelPendingHide();
    if (!shown) return;
    shown.el.remove();
    URL.revokeObjectURL(shown.url);
    shown = null;
  };

  /** Gone now: the keyboard was used, focus left, or the pane is going away. */
  const hideNow = (): void => {
    wanted = null;
    teardown();
  };

  /** Pressing a modifier is not "using the keyboard": the caption asks for
   *  Cmd+click, and Cmd arrives as a keydown of its own, so dismissing on it
   *  took the thumbnail away exactly when the reader reached for it. A
   *  modifier combined with a real key still dismisses, which is what makes
   *  Cmd+2 (switch tab) work. */
  const MODIFIER_KEYS = new Set(["Meta", "Shift", "Alt", "Control", "CapsLock"]);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (MODIFIER_KEYS.has(event.key)) return;
    hideNow();
  };

  /** Gone shortly, unless the same path comes straight back. See
   *  HIDE_GRACE_MS for why the delay is load-bearing. */
  const hide = (): void => {
    wanted = null;
    if (!shown) return;
    cancelPendingHide();
    pendingHide = setTimeout(teardown, HIDE_GRACE_MS);
  };

  /** Cmd+click opens Preview, which takes focus while the pointer has not
   *  moved: xterm re-asks for the link on the next repaint and the thumbnail
   *  would come straight back over the terminal. Losing focus says it should
   *  not. Registered once, for the life of the preview. */
  window.addEventListener("blur", hideNow);

  const place = (el: HTMLElement, anchor: { x: number; y: number }): void => {
    // The image is decoded before the popover is inserted, so these are the
    // real dimensions. The fallback covers a host with no layout at all.
    const width = el.offsetWidth || MAX_EDGE;
    const height = el.offsetHeight || MAX_EDGE;
    const left = Math.min(anchor.x + GAP, window.innerWidth - width - MARGIN);
    // Prefer above the pointer so the popover does not sit on the line being
    // read; drop below when there is no room up there.
    const above = anchor.y - GAP - height;
    const top =
      above >= MARGIN
        ? above
        : Math.min(anchor.y + GAP * 2, window.innerHeight - height - MARGIN);
    el.style.left = `${Math.max(MARGIN, left)}px`;
    el.style.top = `${Math.max(MARGIN, top)}px`;
  };

  /** Fetch, decode and insert. Split out so `show` can dedupe callers onto a
   *  single run of it. Bails at every await whose result is no longer wanted. */
  const load = async (
    path: string,
    anchor: { x: number; y: number },
  ): Promise<void> => {
    let base64: string | null = null;
    try {
      base64 = await invoke<string | null>("read_image_bytes", { path });
    } catch {
      base64 = null;
    }
    if (wanted !== path) return;

    const bytes = base64 ? decodeBase64Bytes(base64, MAX_BYTES) : null;
    const format = bytes ? sniffBitmapFormat(bytes) : null;
    if (!bytes || !format) {
      teardown();
      return;
    }

    // `bytes as BlobPart` matches osc1337-renderer.ts: TypeScript types a
    // Uint8Array over ArrayBufferLike, which no longer satisfies BlobPart.
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: `image/${format}` }),
    );

    const img = document.createElement("img");
    img.src = url;
    img.alt = "";

    // Decode before the popover goes in. An <img> that has not loaded has no
    // dimensions, so a popover placed around it would be measured at the
    // height of its caption alone: it would be pinned just above the pointer,
    // then grow down over the line being read. Decoding first means one
    // placement, at the size it will actually be.
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      teardown();
      return;
    }
    if (wanted !== path) {
      URL.revokeObjectURL(url);
      return;
    }

    teardown();
    const el = document.createElement("div");
    el.className = "image-preview";
    const caption = document.createElement("div");
    caption.className = "image-preview-caption";
    const name = document.createElement("span");
    name.className = "image-preview-name";
    name.textContent = path.slice(path.lastIndexOf("/") + 1);
    const hint = document.createElement("span");
    hint.className = "image-preview-hint";
    hint.textContent = "Cmd+click to open";
    caption.append(name, hint);
    el.append(img, caption);

    document.body.appendChild(el);
    shown = { el, url, path };
    place(el, anchor);
  };

  const show = async (
    path: string,
    anchor: { x: number; y: number },
  ): Promise<void> => {
    if (disposed) return;
    wanted = path;

    // Any keystroke dismisses the thumbnail. The pointer can rest on a link
    // while the keyboard does something else: switching tab with Cmd+2 moves
    // no mouse, so xterm never fires the link's `leave` and the thumbnail
    // would hang over whatever the keystroke brought up. Registered here
    // rather than at creation so a preview that never showed anything cannot
    // leave a listener behind; addEventListener is a no-op for a handler
    // already registered.
    document.addEventListener("keydown", onKeyDown);

    // Already up for this very path: xterm is re-asking after a repaint, so
    // keep the element (and its running animation), just follow the pointer.
    if (shown?.path === path) {
      cancelPendingHide();
      place(shown.el, anchor);
      return;
    }

    // Already being fetched. Nothing is shown yet, so without this the
    // repaint storm that re-asks every frame would start a fresh read of the
    // same file every frame and discard all but the last.
    if (inFlight?.path === path) return inFlight.done;

    const done = load(path, anchor).finally(() => {
      if (inFlight?.path === path) inFlight = null;
    });
    inFlight = { path, done };
    return done;
  };

  return {
    show,
    hide,
    dispose(): void {
      disposed = true;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", hideNow);
      hideNow();
    },
  };
}
