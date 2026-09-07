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
  let shown: { el: HTMLElement; url: string } | null = null;
  // Bumped by every show and every hide. A fetch whose generation is stale
  // lost its race: the pointer has since moved to another link or left the
  // terminal, and its image must not appear.
  let generation = 0;

  const teardown = (): void => {
    if (!shown) return;
    shown.el.remove();
    URL.revokeObjectURL(shown.url);
    shown = null;
  };

  const hide = (): void => {
    generation++;
    teardown();
  };

  // Any keystroke dismisses the thumbnail. The pointer can rest on a link
  // while the keyboard does something else: switching tab with Cmd+2 moves no
  // mouse, so xterm never fires the link's `leave` and the thumbnail would
  // hang over whatever the keystroke brought up. Listening from creation
  // rather than from each show also cancels a fetch that is still in flight.
  document.addEventListener("keydown", hide);

  const place = (el: HTMLElement, anchor: { x: number; y: number }): void => {
    // offsetWidth is 0 until the image has laid out, so fall back to the
    // largest the popover is allowed to be and re-place on load.
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

  const show = async (
    path: string,
    anchor: { x: number; y: number },
  ): Promise<void> => {
    const mine = ++generation;

    let base64: string | null = null;
    try {
      base64 = await invoke<string | null>("read_image_bytes", { path });
    } catch {
      base64 = null;
    }
    if (mine !== generation) return; // superseded by a later hover or a hide

    const bytes = base64 ? decodeBase64Bytes(base64, MAX_BYTES) : null;
    const format = bytes ? sniffBitmapFormat(bytes) : null;
    if (!bytes || !format) {
      teardown();
      return;
    }

    teardown();
    // `bytes as BlobPart` matches osc1337-renderer.ts: TypeScript types a
    // Uint8Array over ArrayBufferLike, which no longer satisfies BlobPart.
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: `image/${format}` }),
    );

    const el = document.createElement("div");
    el.className = "image-preview";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.addEventListener("load", () => {
      if (shown?.el === el) place(el, anchor);
    });
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
    shown = { el, url };
    place(el, anchor);
  };

  return {
    show,
    hide,
    dispose(): void {
      document.removeEventListener("keydown", hide);
      hide();
    },
  };
}
