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

  it("removes the popover and releases the blob on hide", async () => {
    invokeMock.mockResolvedValue(PNG_B64);
    const preview = createImagePreview();
    await preview.show("/tmp/shot.png", { x: 0, y: 0 });

    preview.hide();

    expect(popover()).toBeNull();
    expect(revoked).toEqual([created[0]]);
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

  it("leaves no listener behind on dispose", () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");

    const preview = createImagePreview();
    const registered = added.mock.calls.find((c) => c[0] === "keydown");
    preview.dispose();

    expect(registered).toBeDefined();
    expect(removed).toHaveBeenCalledWith("keydown", registered![1]);
    added.mockRestore();
    removed.mockRestore();
  });
});
