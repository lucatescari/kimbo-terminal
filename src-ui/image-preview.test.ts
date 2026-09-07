// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

import { createImagePreview, isPreviewableImage } from "./image-preview";

// A one-pixel PNG, base64, exactly as the backend hands it over.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

let created: string[] = [];
let revoked: string[] = [];
let seq = 0;

beforeEach(() => {
  invokeMock.mockReset();
  created = [];
  revoked = [];
  seq = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock/${++seq}`;
    created.push(url);
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  }) as unknown as typeof URL.revokeObjectURL;
  // jsdom implements neither blob URLs nor image decoding. Production decodes
  // the bitmap before inserting the popover so it can be placed at its real
  // size; here the decode resolves and the element keeps a zero-sized box,
  // which is what the MAX_EDGE fallback in place() is for.
  HTMLImageElement.prototype.decode = vi
    .fn()
    .mockResolvedValue(undefined) as unknown as HTMLImageElement["decode"];
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

function popover(): HTMLElement | null {
  return document.querySelector(".image-preview");
}

describe("isPreviewableImage", () => {
  it("accepts the bitmap extensions the renderer can decode, any case", () => {
    expect(isPreviewableImage("/tmp/shot.png")).toBe(true);
    expect(isPreviewableImage("/tmp/SHOT.PNG")).toBe(true);
    expect(isPreviewableImage("/tmp/a.jpeg")).toBe(true);
    expect(isPreviewableImage("/tmp/a.jpg")).toBe(true);
    expect(isPreviewableImage("/tmp/a.gif")).toBe(true);
    expect(isPreviewableImage("/tmp/a.webp")).toBe(true);
  });

  it("rejects anything else, including extensionless paths and directories", () => {
    expect(isPreviewableImage("/tmp/notes.md")).toBe(false);
    expect(isPreviewableImage("/tmp/archive.png.zip")).toBe(false);
    expect(isPreviewableImage("/tmp/somedir")).toBe(false);
    expect(isPreviewableImage("/tmp/.png")).toBe(false);
  });
});

describe("createImagePreview", () => {
  it("shows the image the backend returns, captioned with the file name", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();

    await preview.show("/tmp/new-desktop-ticked.png", { x: 40, y: 60 });

    const img = popover()?.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.src).toBe(created[0]);
    expect(popover()!.textContent).toContain("new-desktop-ticked.png");
  });

  it("asks the backend for the path it was given", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();

    await preview.show("/tmp/shot.png", { x: 0, y: 0 });

    expect(invokeMock).toHaveBeenCalledWith("read_image_bytes", {
      path: "/tmp/shot.png",
    });
  });

  it("removes the popover and releases the blob shortly after hide", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 0, y: 0 });

    preview.hide();
    vi.runAllTimers();

    expect(popover()).toBeNull();
    expect(revoked).toEqual([created[0]]);
    vi.useRealTimers();
  });

  it("shows nothing when the backend refuses the file", async () => {
    invokeMock.mockResolvedValue(null);
    const preview = createImagePreview();

    await preview.show("/tmp/gone.png", { x: 0, y: 0 });

    expect(popover()).toBeNull();
    expect(created).toEqual([]);
  });

  it("shows nothing when the bytes are not a bitmap we can decode", async () => {
    invokeMock.mockResolvedValue(btoa("this is not an image at all"));
    const preview = createImagePreview();

    await preview.show("/tmp/fake.png", { x: 0, y: 0 });

    expect(popover()).toBeNull();
  });

  it("drops an in-flight image once a later hover supersedes it", async () => {
    // First hover resolves slowly, second resolves immediately. Without a
    // generation guard the slow one lands last and the popover ends up showing
    // the image for a link the pointer already left.
    let releaseFirst: (v: string) => void = () => {};
    invokeMock
      .mockImplementationOnce(
        () => new Promise<string>((res) => (releaseFirst = res)),
      )
      .mockResolvedValueOnce(PNG_B64);
    const preview = createImagePreview();

    const first = preview.show("/tmp/one.png", { x: 0, y: 0 });
    await preview.show("/tmp/two.png", { x: 0, y: 0 });
    const afterSecond = popover()!.querySelector("img")!.src;
    releaseFirst(PNG_B64);
    await first;

    expect(popover()!.querySelector("img")!.src).toBe(afterSecond);
    expect(created).toHaveLength(1);
  });

  it("keeps the popover inside the viewport near the right edge", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();

    await preview.show("/tmp/shot.png", { x: window.innerWidth - 4, y: 20 });

    const left = Number.parseFloat(popover()!.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(window.innerWidth);
  });

  it("releases everything on dispose", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 0, y: 0 });

    preview.dispose();

    expect(popover()).toBeNull();
    expect(revoked).toEqual([created[0]]);
  });

  it("does not pop up an image the pointer has already left", async () => {
    let release: (v: string) => void = () => {};
    invokeMock.mockImplementation(
      () => new Promise<string>((res) => (release = res)),
    );
    const preview = createImagePreview();

    const pending = preview.show("/tmp/shot.png", { x: 0, y: 0 });
    preview.hide();
    release(PNG_B64);
    await pending;

    expect(popover()).toBeNull();
  });
});

describe("createImagePreview dismissal on input", () => {
  it("takes the thumbnail down on any keystroke", async () => {
    // The pointer can sit on a link while the keyboard does something else:
    // switching tab with Cmd+2 moves no mouse, so xterm never fires `leave`
    // and the thumbnail would hang over the tab you switched to.
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));

    expect(popover()).toBeNull();
  });

  it("cancels a thumbnail still loading when a keystroke arrives", async () => {
    let release: (v: string) => void = () => {};
    invokeMock.mockImplementation(
      () => new Promise<string>((res) => (release = res)),
    );
    const preview = createImagePreview();

    const pending = preview.show("/tmp/shot.png", { x: 10, y: 10 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    release(PNG_B64);
    await pending;

    expect(popover()).toBeNull();
  });

  it("leaves no listener behind on dispose", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");

    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 0, y: 0 });
    const registered = added.mock.calls.find((c) => c[0] === "keydown");
    preview.dispose();

    expect(registered).toBeDefined();
    expect(removed).toHaveBeenCalledWith("keydown", registered![1]);
    added.mockRestore();
    removed.mockRestore();
  });

  it("registers nothing at all until it has something to show", () => {
    // createImagePreview runs while the pane is still being built, before the
    // PTY exists. If it registered a listener there and the pane then failed
    // to come up, dispose would never be reached and the listener would
    // outlive the attempt.
    const added = vi.spyOn(document, "addEventListener");

    createImagePreview();

    expect(added.mock.calls.filter((c) => c[0] === "keydown")).toEqual([]);
    added.mockRestore();
  });
});

describe("createImagePreview while xterm re-asks for the hovered link", () => {
  // xterm drops the current link and asks the provider again on every repaint
  // of the hovered row, firing leave then hover each time. While output
  // streams that is once a frame, so a hide that tore down at once would
  // re-read the file over IPC and restart the entrance animation every frame:
  // the thumbnail would strobe and never rise above a sliver of opacity.
  it("does not re-read the file when the same path comes straight back", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    preview.hide();
    await preview.show("/tmp/shot.png", { x: 11, y: 10 });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(popover()).not.toBeNull();
  });

  it("keeps the very same element, so the entrance animation is not restarted", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });
    const first = popover();

    preview.hide();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    expect(popover()).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("still moves to the new pointer position on the way back", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 400 });

    preview.hide();
    await preview.show("/tmp/shot.png", { x: 10, y: 300 });

    // 300 - GAP - MAX_EDGE is negative, so it drops below the pointer.
    expect(popover()!.style.top).toBe("324px");
  });

  it("swaps the image when a different path is hovered", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/one.png", { x: 10, y: 10 });

    preview.hide();
    await preview.show("/tmp/two.png", { x: 10, y: 10 });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(popover()!.textContent).toContain("two.png");
    expect(revoked).toEqual([created[0]]);
  });

  it("a keystroke removes the thumbnail at once, with no grace period", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(popover()).toBeNull();
    vi.useRealTimers();
  });
});

describe("createImagePreview and modifier keys", () => {
  it("survives a bare Cmd press, which is how you open the file", async () => {
    // The caption tells you to Cmd+click. Pressing Cmd is a keydown of its
    // own, so dismissing on every key made the thumbnail vanish exactly when
    // you reached for it.
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    for (const key of ["Meta", "Shift", "Alt", "Control"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key }));
    }

    expect(popover()).not.toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("still goes away on a key that does something", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    // Cmd+2 switches tab, which moves no mouse and so fires no `leave`.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", metaKey: true }),
    );

    expect(popover()).toBeNull();
  });
});

describe("createImagePreview lifecycle gaps found in review", () => {
  it("goes away when the window loses focus", async () => {
    // Cmd+click opens Preview on top. The pointer has not moved, so xterm
    // re-asks for the link on the next repaint and the thumbnail comes
    // straight back; losing focus is the signal that it should not.
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    window.dispatchEvent(new Event("blur"));

    expect(popover()).toBeNull();
  });

  it("reads the file once even when asked repeatedly before it lands", async () => {
    // The same-path shortcut keys off what is already shown, and nothing is
    // shown until the read completes. A TUI repainting at 60fps therefore
    // issued a fresh read every frame for the whole load window, each one up
    // to 10MB base64-encoded across IPC, and threw all but one away.
    let release: (v: string) => void = () => {};
    invokeMock.mockImplementation(
      () => new Promise<string>((res) => (release = res)),
    );
    const preview = createImagePreview();

    const shows = [
      preview.show("/tmp/shot.png", { x: 10, y: 10 }),
      preview.show("/tmp/shot.png", { x: 10, y: 10 }),
      preview.show("/tmp/shot.png", { x: 10, y: 10 }),
    ];
    release(PNG_B64);
    await Promise.all(shows);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(popover()).not.toBeNull();
    expect(created).toHaveLength(1);
  });

  it("shows nothing after dispose", async () => {
    // dispose runs while the pane is being torn down. A show that slipped
    // through afterwards would insert a popover with no owner left to remove
    // it, and re-register the keydown listener dispose had just removed.
    invokeMock.mockResolvedValue(PNG_B64);
    const added = vi.spyOn(document, "addEventListener");
    const preview = createImagePreview();

    preview.dispose();
    await preview.show("/tmp/shot.png", { x: 10, y: 10 });

    expect(popover()).toBeNull();
    expect(added.mock.calls.filter((c) => c[0] === "keydown")).toEqual([]);
    added.mockRestore();
  });

  it("leaves no window listener behind on dispose", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const removed = vi.spyOn(window, "removeEventListener");
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 0, y: 0 });

    preview.dispose();

    expect(removed.mock.calls.some((c) => c[0] === "blur")).toBe(true);
    removed.mockRestore();
  });
});

describe("createImagePreview when the pointer crosses several paths", () => {
  /** A backend whose reads resolve only when told to, per path. */
  function heldBackend() {
    const release: Record<string, (v: string) => void> = {};
    invokeMock.mockImplementation(
      (_cmd: string, args: { path: string }) =>
        new Promise<string>((res) => (release[args.path] = res)),
    );
    return release;
  }

  it("does not start a second read when the pointer comes back mid-flight", async () => {
    // A then B then back to A, all while A's read is still out. Deduping only
    // against the one fetch being tracked meant B displaced A, so returning to
    // A started a second read of it, and both renders landed: the second tore
    // the first down and rebuilt it, restarting the entrance animation. That
    // is the strobe the whole design exists to avoid.
    const release = heldBackend();
    const preview = createImagePreview();

    const a1 = preview.show("/tmp/a.png", { x: 10, y: 10 });
    const b = preview.show("/tmp/b.png", { x: 20, y: 10 });
    const a2 = preview.show("/tmp/a.png", { x: 30, y: 10 });
    release["/tmp/a.png"]?.(PNG_B64);
    release["/tmp/b.png"]?.(PNG_B64);
    await Promise.all([a1, b, a2]);

    const readsOfA = invokeMock.mock.calls.filter(
      (c) => (c[1] as { path: string }).path === "/tmp/a.png",
    );
    expect(readsOfA).toHaveLength(1);
    expect(created).toHaveLength(1); // one popover built, not two
  });

  it("appears at the pointer's latest position, not where the read started", async () => {
    // The pointer slides along a long underlined path while the read is out.
    // Joining the in-flight read must not also inherit its stale anchor.
    const release = heldBackend();
    const preview = createImagePreview();

    const first = preview.show("/tmp/a.png", { x: 100, y: 400 });
    const second = preview.show("/tmp/a.png", { x: 640, y: 400 });
    release["/tmp/a.png"]?.(PNG_B64);
    await Promise.all([first, second]);

    // Anchored at 640 the popover is clamped to the window; at the stale 100
    // it would sit at 112px.
    expect(popover()!.style.left).not.toBe("112px");
    expect(Number.parseFloat(popover()!.style.left)).toBeGreaterThan(600);
  });
});
