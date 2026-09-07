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

/** A hover target standing in for a link whose box sits at the given point.
 *  The pointer is reported at the same place, which is what the real provider
 *  does when the pointer is inside the link. */
function at(x: number, y: number) {
  return {
    rect: { left: x, right: x + 40, top: y, bottom: y + 10 },
    pointer: { x, y },
  };
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

    await preview.show("/tmp/new-desktop-ticked.png", at(40, 60));

    const img = popover()?.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.src).toBe(created[0]);
    expect(popover()!.textContent).toContain("new-desktop-ticked.png");
  });

  it("asks the backend for the path it was given", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();

    await preview.show("/tmp/shot.png", at(0, 0));

    expect(invokeMock).toHaveBeenCalledWith("read_image_bytes", {
      path: "/tmp/shot.png",
    });
  });

  it("removes the popover and releases the blob shortly after hide", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(0, 0));

    preview.hide();
    vi.runAllTimers();

    expect(popover()).toBeNull();
    expect(revoked).toEqual([created[0]]);
    vi.useRealTimers();
  });

  it("shows nothing when the backend refuses the file", async () => {
    invokeMock.mockResolvedValue(null);
    const preview = createImagePreview();

    await preview.show("/tmp/gone.png", at(0, 0));

    expect(popover()).toBeNull();
    expect(created).toEqual([]);
  });

  it("shows nothing when the bytes are not a bitmap we can decode", async () => {
    invokeMock.mockResolvedValue(btoa("this is not an image at all"));
    const preview = createImagePreview();

    await preview.show("/tmp/fake.png", at(0, 0));

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

    const first = preview.show("/tmp/one.png", at(0, 0));
    await preview.show("/tmp/two.png", at(0, 0));
    const afterSecond = popover()!.querySelector("img")!.src;
    releaseFirst(PNG_B64);
    await first;

    expect(popover()!.querySelector("img")!.src).toBe(afterSecond);
    expect(created).toHaveLength(1);
  });

  it("keeps the popover inside the viewport near the right edge", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();

    await preview.show("/tmp/shot.png", at(window.innerWidth - 4, 20));

    const left = Number.parseFloat(popover()!.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(window.innerWidth);
  });

  it("releases everything on dispose", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(0, 0));

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

    const pending = preview.show("/tmp/shot.png", at(0, 0));
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
    await preview.show("/tmp/shot.png", at(10, 10));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));

    expect(popover()).toBeNull();
  });

  it("cancels a thumbnail still loading when a keystroke arrives", async () => {
    let release: (v: string) => void = () => {};
    invokeMock.mockImplementation(
      () => new Promise<string>((res) => (release = res)),
    );
    const preview = createImagePreview();

    const pending = preview.show("/tmp/shot.png", at(10, 10));
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
    await preview.show("/tmp/shot.png", at(0, 0));
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
    await preview.show("/tmp/shot.png", at(10, 10));

    preview.hide();
    await preview.show("/tmp/shot.png", at(11, 10));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(popover()).not.toBeNull();
  });

  it("keeps the very same element, so the entrance animation is not restarted", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));
    const first = popover();

    preview.hide();
    await preview.show("/tmp/shot.png", at(10, 10));

    expect(popover()).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("re-places against the link on the way back", async () => {
    // The row can have scrolled while it was away, so the kept element is
    // placed again from the newest rect.
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 400));

    preview.hide();
    await preview.show("/tmp/shot.png", at(10, 300));

    // No room above a link at y=300 for a 360px thumbnail, so it drops just
    // below the link's bottom edge.
    expect(popover()!.style.top).toBe("322px");
  });

  it("swaps the image when a different path is hovered", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/one.png", at(10, 10));

    preview.hide();
    await preview.show("/tmp/two.png", at(10, 10));

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(popover()!.textContent).toContain("two.png");
    expect(revoked).toEqual([created[0]]);
  });

  it("a keystroke removes the thumbnail at once, with no grace period", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));

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
    await preview.show("/tmp/shot.png", at(10, 10));

    for (const key of ["Meta", "Shift", "Alt", "Control"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key }));
    }

    expect(popover()).not.toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("still goes away on a key that does something", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));

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
    await preview.show("/tmp/shot.png", at(10, 10));

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
      preview.show("/tmp/shot.png", at(10, 10)),
      preview.show("/tmp/shot.png", at(10, 10)),
      preview.show("/tmp/shot.png", at(10, 10)),
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
    await preview.show("/tmp/shot.png", at(10, 10));

    expect(popover()).toBeNull();
    expect(added.mock.calls.filter((c) => c[0] === "keydown")).toEqual([]);
    added.mockRestore();
  });

  it("leaves no window listener behind on dispose", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const removed = vi.spyOn(window, "removeEventListener");
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(0, 0));

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

    const a1 = preview.show("/tmp/a.png", at(10, 10));
    const b = preview.show("/tmp/b.png", at(20, 10));
    const a2 = preview.show("/tmp/a.png", at(30, 10));
    release["/tmp/a.png"]?.(PNG_B64);
    release["/tmp/b.png"]?.(PNG_B64);
    await Promise.all([a1, b, a2]);

    const readsOfA = invokeMock.mock.calls.filter(
      (c) => (c[1] as { path: string }).path === "/tmp/a.png",
    );
    expect(readsOfA).toHaveLength(1);
    expect(created).toHaveLength(1); // one popover built, not two
  });

  it("appears against the newest link box, not the one the read started on", async () => {
    // The same file can be named twice on screen. Joining a read already in
    // flight must not inherit the box it started against.
    const release = heldBackend();
    const preview = createImagePreview();

    const first = preview.show("/tmp/a.png", at(100, 400));
    const second = preview.show("/tmp/a.png", at(640, 400));
    release["/tmp/a.png"]?.(PNG_B64);
    await Promise.all([first, second]);

    // Centred on the second box (640..680) a 360px thumbnail starts at 480;
    // centred on the first (100..140) it would be clamped to the 8px margin.
    expect(Number.parseFloat(popover()!.style.left)).toBeCloseTo(480, 0);
  });
});

describe("createImagePreview failure and dismissal handling", () => {
  /** Take manual control of image decoding for one test. Returns the pending
   *  decodes in call order so they can be settled individually. */
  function manualDecode() {
    const calls: Array<{ resolve: () => void; reject: () => void }> = [];
    HTMLImageElement.prototype.decode = vi.fn(
      () =>
        new Promise<void>((res, rej) => {
          calls.push({ resolve: () => res(), reject: () => rej(new Error("bad")) });
        }),
    ) as unknown as HTMLImageElement["decode"];
    return calls;
  }

  it("a rejected decode does not remove the thumbnail the pointer is on", async () => {
    // A truncated file passes the magic-byte sniff and only fails at decode.
    // If that late failure tears down whatever is on screen, it takes another
    // path's thumbnail with it and nothing is left to put it back.
    invokeMock.mockResolvedValue(PNG_B64);
    const decodes = manualDecode();
    const preview = createImagePreview();

    const bad = preview.show("/tmp/corrupt.png", at(10, 10));
    await Promise.resolve();
    const good = preview.show("/tmp/good.png", at(20, 10));
    await Promise.resolve();
    decodes[1]?.resolve(); // the good one lands first
    await good;
    decodes[0]?.reject(); // the abandoned one fails afterwards
    await bad;

    expect(popover()).not.toBeNull();
    expect(popover()!.textContent).toContain("good.png");
  });

  it("does not read a file again and again once it has failed", async () => {
    // xterm re-asks for the hovered link on every repaint. A file that cannot
    // be previewed (too large, deleted, mislabelled) leaves nothing shown and
    // nothing in flight, so every frame started the read afresh.
    invokeMock.mockResolvedValue(null);
    const preview = createImagePreview();

    for (let i = 0; i < 10; i++) {
      preview.hide();
      await preview.show("/tmp/gone.png", at(10, 10));
    }

    expect(invokeMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("stays dismissed after the window loses focus, until the pointer moves", async () => {
    // The pointer has not moved, so xterm keeps re-asking on every repaint.
    // A dismissal that only lasts one frame is no dismissal at all, which is
    // what made the blur handler useless against Cmd+click opening Preview.
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));

    window.dispatchEvent(new Event("blur"));
    preview.hide();
    await preview.show("/tmp/shot.png", at(10, 10));

    expect(popover()).toBeNull();

    // Moving the pointer is a fresh intent, so it comes back.
    await preview.show("/tmp/shot.png", at(400, 300));
    expect(popover()).not.toBeNull();
  });

  it("stays dismissed after a keystroke, until the pointer moves", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", metaKey: true }));
    preview.hide();
    await preview.show("/tmp/shot.png", at(10, 10));

    expect(popover()).toBeNull();
  });
});

describe("createImagePreview dismissal and memo edge cases", () => {
  it("stays dismissed when the hide came before the blur", async () => {
    // This is the Cmd+click path exactly: the link's activate() calls hide()
    // and only then does Preview.app take focus. Recording the dismissal from
    // what is currently wanted found nothing, because hide() had already
    // cleared it, so the next repaint put the thumbnail straight back.
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));

    preview.hide(); // activate()
    window.dispatchEvent(new Event("blur")); // Preview.app takes focus
    await preview.show("/tmp/shot.png", at(10, 10)); // next repaint

    expect(popover()).toBeNull();
  });

  it("stays dismissed when a keystroke lands after the hide", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", at(10, 10));

    preview.hide();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", metaKey: true }));
    await preview.show("/tmp/shot.png", at(10, 10));

    expect(popover()).toBeNull();
  });

  it("remembers a failure even when the pointer moved on before it landed", async () => {
    // A read that comes back empty is a fact about the file, whichever path
    // the pointer is on by then. Classifying it as merely overtaken threw the
    // fact away, so the next hover read the same doomed file again.
    let releaseA: (v: string | null) => void = () => {};
    invokeMock.mockImplementation((_cmd: string, args: { path: string }) =>
      args.path === "/tmp/a.png"
        ? new Promise((res) => (releaseA = res))
        : Promise.resolve(PNG_B64),
    );
    const preview = createImagePreview();

    const a = preview.show("/tmp/a.png", at(10, 10));
    await preview.show("/tmp/b.png", at(20, 10));
    releaseA(null); // a cannot be previewed
    await a;
    invokeMock.mockClear();

    await preview.show("/tmp/a.png", at(400, 300));

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not render an older path over the one the pointer is on", async () => {
    // show() bailed on a dismissed or failed path before recording what is
    // wanted, so the previous path stayed "wanted" and its read rendered over
    // the top when it landed.
    let releaseA: (v: string) => void = () => {};
    invokeMock.mockImplementation((_cmd: string, args: { path: string }) =>
      args.path === "/tmp/a.png"
        ? new Promise<string>((res) => (releaseA = res))
        : Promise.resolve(null),
    );
    const preview = createImagePreview();

    await preview.show("/tmp/b.png", at(20, 10)); // fails, now memoized
    const a = preview.show("/tmp/a.png", at(10, 10)); // read starts
    await preview.show("/tmp/b.png", at(300, 300)); // bails on the memo
    releaseA(PNG_B64);
    await a;

    expect(popover()).toBeNull();
  });

});
