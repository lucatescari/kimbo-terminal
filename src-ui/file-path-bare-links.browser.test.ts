import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";

// A file named without its folder ("shot.png") has to become a real link in a
// real xterm: hovering it must turn the pointer into a hand, and Cmd+click
// must open the file the backend found. Only the Tauri IPC is faked; the
// terminal, its buffer and its link plumbing are the real thing.

const invokeMock = vi.fn();
const openMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openMock(...args),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import { attachFilePathLinks } from "./file-path-links";

const LINE = "1. shot.png: the cancellation policy";
const RESOLVED = "/Users/someone/Downloads/shot.png";

/** Viewport point at the middle of a cell on the first row. */
function cellPoint(term: Terminal, col: number): { x: number; y: number } {
  const box = term.element!.querySelector(".xterm-screen")!.getBoundingClientRect();
  return {
    x: box.left + (col + 0.5) * (box.width / term.cols),
    y: box.top + 0.5 * (box.height / term.rows),
  };
}

function rowHeight(term: Terminal): number {
  return term.element!.querySelector(".xterm-screen")!.getBoundingClientRect().height / term.rows;
}

/** xterm marks its screen element while the pointer is over a link. */
function showsHandPointer(term: Terminal): boolean {
  return term.element!.querySelector(".xterm-screen")!.classList.contains("xterm-cursor-pointer");
}

function mouse(term: Terminal, type: string, col: number, init: MouseEventInit = {}) {
  const { x, y } = cellPoint(term, col);
  const target = term.element!.querySelector(".xterm-screen")!;
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y, ...init }),
  );
}

describe("bare filename links in a real terminal", () => {
  let host: HTMLElement;
  let term: Terminal;

  beforeEach(async () => {
    invokeMock.mockReset();
    openMock.mockClear();
    // The backend finds "shot.png" only when asked to look in the user's
    // folders too, as the real command does for a file sitting in Downloads.
    invokeMock.mockImplementation(
      async (_cmd: string, args: { raw: string; searchUserDirs?: boolean }) =>
        args.raw === "shot.png" && args.searchUserDirs === true ? RESOLVED : null,
    );

    host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "300px";
    document.body.appendChild(host);
    term = new Terminal({ cols: 80, rows: 10 });
    term.open(host);
    attachFilePathLinks(term, () => "/Users/someone/project");
    await new Promise<void>((done) => term.write(LINE, done));
  });

  afterEach(() => {
    term.dispose();
    host.remove();
  });

  it("shows the hand pointer over the filename and not over ordinary words", async () => {
    mouse(term, "mousemove", LINE.indexOf("cancellation") + 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(showsHandPointer(term)).toBe(false);

    mouse(term, "mousemove", LINE.indexOf("shot.png") + 2);
    await expect.poll(() => showsHandPointer(term)).toBe(true);
  });

  it("opens the file the backend found on Cmd+click", async () => {
    const col = LINE.indexOf("shot.png") + 2;
    mouse(term, "mousemove", col);
    await expect.poll(() => showsHandPointer(term)).toBe(true);

    mouse(term, "mousedown", col, { metaKey: true });
    mouse(term, "mouseup", col, { metaKey: true });

    await expect.poll(() => openMock.mock.calls.length).toBe(1);
    expect(openMock).toHaveBeenCalledWith(RESOLVED);
  });
});

describe("a path created after its first hover, in a real terminal", () => {
  const TEXT = "screenshots land in /out/journey/.";
  let host: HTMLElement;
  let term: Terminal;
  let exists: boolean;

  beforeEach(async () => {
    invokeMock.mockReset();
    exists = false;
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      exists && args.raw === "/out/journey/" ? "/out/journey" : null,
    );
    host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "300px";
    document.body.appendChild(host);
    term = new Terminal({ cols: 80, rows: 10 });
    term.open(host);
    attachFilePathLinks(term, () => "/cwd");
    await new Promise<void>((done) => term.write(TEXT + "\r\nsecond row", done));
  });

  afterEach(() => {
    term.dispose();
    host.remove();
  });

  it("becomes clickable once the folder exists", async () => {
    const col = TEXT.indexOf("/out/journey") + 3;

    // First hover: the folder is not there yet, so no link.
    mouse(term, "mousemove", col);
    await expect.poll(() => invokeMock.mock.calls.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 150));
    expect(showsHandPointer(term)).toBe(false);

    // The tool creates the folder. Keep moving the pointer off the row and
    // back, as a person would, until the link shows up.
    exists = true;
    await expect
      .poll(
        () => {
          mouse(term, "mousemove", 2, { clientY: cellPoint(term, 2).y + rowHeight(term) });
          mouse(term, "mousemove", col);
          return new Promise<boolean>((r) => setTimeout(() => r(showsHandPointer(term)), 150));
        },
        { timeout: 8_000, interval: 400 },
      )
      .toBe(true);
  });
});
