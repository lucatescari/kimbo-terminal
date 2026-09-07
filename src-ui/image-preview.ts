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

/** How long a failed read is remembered, so a file that cannot be previewed
 *  is not read again on every repaint. Time-limited because a screenshot can
 *  be read while it is still being written. */
const FAILURE_MEMO_MS = 5_000;
/** Cap on remembered failures, so a long session cannot grow the map. */
const MAX_FAILURES = 64;
/** How far the pointer must move for a dismissed thumbnail to be welcome
 *  again. Small, because it only has to beat "did not move at all". */
const MOVED_PX = 2;

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

/** A point in viewport coordinates: where the pointer is. */
export interface Anchor {
  x: number;
  y: number;
}

export interface ImagePreview {
  /** Fetch and show `path` near a viewport point. Resolves once the popover is
   *  up, or once the attempt has been abandoned. Never rejects. */
  show(path: string, anchor: Anchor): Promise<void>;
  /** Take the popover down and cancel any fetch still in flight. */
  hide(): void;
  /** Tear down for good. Safe to call more than once. */
  dispose(): void;
}

export function createImagePreview(): ImagePreview {
  // Ownership is the whole design here. Three rounds of bugs in this module
  // were all the same shape: a fetch that finished after the pointer had moved
  // on, writing to the display anyway. So the async work below builds a
  // popover and touches nothing else, and every mutation of what is on screen
  // goes through `clear` and `render`, which are called from exactly one gate
  // after all awaits have settled.

  /** The path the pointer is on and where, or null for none. A completed read
   *  renders only if this still names its path. Written only by show, hide,
   *  hideNow and dispose. */
  let desired: { path: string; anchor: Anchor } | null = null;
  /** The last thing show was asked for, kept even after hide clears `desired`.
   *  A dismissal needs it: the link's activate() hides the thumbnail and only
   *  then does Preview.app take focus, so by the time the blur arrives there
   *  is nothing left in `desired` to record, and the dismissal was lost. */
  let lastRequest: { path: string; anchor: Anchor } | null = null;
  /** What IS on screen. Written only by clear and render. */
  let displayed: { path: string; el: HTMLElement; url: string } | null = null;
  /** What was taken away by the keyboard or by losing focus, and where the
   *  pointer was at the time. xterm re-asks for the hovered link on every
   *  repaint without the pointer moving, so a dismissal that does not outlive
   *  the frame is not a dismissal at all. */
  let dismissed: { path: string; anchor: Anchor } | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  /** Loads in flight, keyed by path, so a repaint storm joins the read already
   *  out instead of starting another. Keyed rather than a single slot because
   *  the pointer can cross a second path and come back while the first is
   *  still running. */
  const loads = new Map<string, Promise<void>>();
  /** Paths whose load failed, and when. Without this a file that cannot be
   *  previewed at all (over the size cap, deleted, mislabelled) was read again
   *  every single frame, since nothing was shown and nothing was in flight. */
  const failures = new Map<string, number>();

  const cancelHideTimer = (): void => {
    if (hideTimer === null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  /** One of the two functions allowed to touch the DOM or a blob URL. */
  const clear = (): void => {
    cancelHideTimer();
    if (!displayed) return;
    displayed.el.remove();
    URL.revokeObjectURL(displayed.url);
    displayed = null;
  };

  /** The other one. */
  const render = (path: string, el: HTMLElement, url: string, anchor: Anchor): void => {
    clear();
    document.body.appendChild(el);
    displayed = { path, el, url };
    place(el, anchor);
  };

  const rememberFailure = (path: string): void => {
    if (failures.size >= MAX_FAILURES) {
      const oldest = failures.keys().next().value;
      if (oldest !== undefined) failures.delete(oldest);
    }
    failures.set(path, Date.now());
  };

  const recentlyFailed = (path: string): boolean => {
    const at = failures.get(path);
    if (at === undefined) return false;
    // Time-limited rather than permanent: a screenshot can be read while it is
    // still being written, and that should not disqualify it for the session.
    if (Date.now() - at < FAILURE_MEMO_MS) return true;
    failures.delete(path);
    return false;
  };

  const stillDismissed = (path: string, anchor: Anchor): boolean =>
    dismissed !== null &&
    dismissed.path === path &&
    Math.abs(dismissed.anchor.x - anchor.x) <= MOVED_PX &&
    Math.abs(dismissed.anchor.y - anchor.y) <= MOVED_PX;

  /** Gone now: the keyboard was used, focus left, or the pane is going away.
   *  Stays gone until the pointer moves or lands on something else. */
  const hideNow = (): void => {
    const target = desired ?? lastRequest;
    if (target) dismissed = { path: target.path, anchor: target.anchor };
    desired = null;
    clear();
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
    desired = null;
    if (!displayed) return;
    cancelHideTimer();
    hideTimer = setTimeout(clear, HIDE_GRACE_MS);
  };

  /** Cmd+click opens Preview, which takes focus while the pointer has not
   *  moved. Losing focus dismisses the thumbnail, and because a dismissal
   *  outlives the frame it does not come straight back on the next repaint. */
  window.addEventListener("blur", hideNow);

  const place = (el: HTMLElement, anchor: Anchor): void => {
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

  /** Read, decode and build the popover for `path`. Deliberately touches no
   *  shared state and never renders: it returns something for the single gate
   *  in `load` to accept or throw away, which is what stops a fetch that has
   *  been overtaken from writing to the display. `stillWanted` is a read, not
   *  a write, and only lets it stop early rather than decode an image nobody
   *  is waiting for. Anything it allocated is released before it gives up. */
  const build = async (
    path: string,
    stillWanted: () => boolean,
  ): Promise<{ el: HTMLElement; url: string } | "failed" | "abandoned"> => {
    let base64: string | null = null;
    try {
      base64 = await invoke<string | null>("read_image_bytes", { path });
    } catch {
      return "failed";
    }

    // Classify what came back BEFORE giving up on it. A read that returned
    // nothing usable is a fact about the file whichever path the pointer is on
    // by now, and calling it merely "overtaken" threw that fact away, so the
    // next hover read the same doomed file again.
    const bytes = base64 ? decodeBase64Bytes(base64, MAX_BYTES) : null;
    const format = bytes ? sniffBitmapFormat(bytes) : null;
    if (!bytes || !format) return "failed";

    // Overtaken while the file was being read: worth stopping before decoding
    // a bitmap nobody is going to look at.
    if (!stillWanted()) return "abandoned";

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
      return "failed";
    }

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
    return { el, url };
  };

  /** The single gate. Everything a completed load is permitted to do is here,
   *  and it happens after every await has settled, so there is no window in
   *  which a stale result can act. */
  const load = async (path: string): Promise<void> => {
    const built = await build(path, () => desired?.path === path);

    if (built === "abandoned") return;
    if (built === "failed") {
      rememberFailure(path);
      // Only take the display down if the failure is about what is wanted now.
      // A late failure for a path the pointer has already left must not remove
      // the thumbnail of the one it has moved to.
      if (desired?.path === path) clear();
      return;
    }
    if (desired?.path !== path) {
      URL.revokeObjectURL(built.url);
      return;
    }
    render(path, built.el, built.url, desired.anchor);
  };

  const show = async (path: string, anchor: Anchor): Promise<void> => {
    if (disposed) return;

    // Record where the pointer is BEFORE any early return. Bailing out first
    // left `desired` naming the previous path, so a read still running for it
    // passed the gate and rendered over the one the pointer had moved to.
    lastRequest = { path, anchor };
    desired = { path, anchor };

    // A dismissal holds until the pointer moves or moves on.
    if (stillDismissed(path, anchor)) return;
    dismissed = null;
    if (recentlyFailed(path)) return;

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
    if (displayed?.path === path) {
      cancelHideTimer();
      place(displayed.el, anchor);
      return;
    }

    // Already being read. Nothing is shown yet, so without this the repaint
    // storm that re-asks every frame would start a fresh read of the same file
    // every frame and discard all but the last. The newest anchor is already
    // recorded above, so joining a read does not inherit a stale one.
    const running = loads.get(path);
    if (running) return running;

    const done = load(path).finally(() => {
      // Compare identity, not just the key: a stale run must not delete the
      // entry belonging to a newer one for the same path.
      if (loads.get(path) === done) loads.delete(path);
    });
    loads.set(path, done);
    return done;
  };

  return {
    show,
    hide,
    dispose(): void {
      disposed = true;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", hideNow);
      desired = null;
      lastRequest = null;
      clear();
    },
  };
}
