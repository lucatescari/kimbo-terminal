// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const openMock = vi.fn().mockResolvedValue(undefined);
const revealMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openMock(...args),
  revealItemInDir: (...args: unknown[]) => revealMock(...args),
}));

import { attachFilePathLinks } from "./file-path-links";

interface FakeLink {
  range: { start: { x: number; y: number }; end: { x: number; y: number } };
  text: string;
  activate: (event: MouseEvent, text: string) => void;
  hover?: (event: MouseEvent, text: string) => void;
  leave?: (event: MouseEvent, text: string) => void;
}

/** Minimal xterm stand-in: one buffer line, captures the link provider. */
function fakeTerm(lineText: string) {
  let provider: { provideLinks(y: number, cb: (links: FakeLink[] | undefined) => void): void } | null = null;
  const scrollListeners: Array<() => void> = [];
  const term = {
    cols: 80,
    buffer: {
      active: {
        getLine: (i: number) =>
          i === 0 ? { translateToString: () => lineText } : null,
      },
    },
    registerLinkProvider: (p: typeof provider) => {
      provider = p;
      return { dispose() {} };
    },
    onScroll: (cb: () => void) => {
      scrollListeners.push(cb);
      return { dispose() {} };
    },
  };
  return {
    term,
    getProvider: () => provider!,
    scroll: () => {
      for (const cb of scrollListeners) cb();
    },
    scrollListenerCount: () => scrollListeners.length,
  };
}

/** Drive the (async) provider for line 1 and resolve with its links. */
function provide(provider: ReturnType<typeof fakeTerm>["getProvider"]): Promise<FakeLink[] | undefined> {
  return new Promise((res) => provider().provideLinks(1, res));
}

/** xterm stand-in whose buffer holds several rows, some of them continuations
 *  of the row above (xterm sets isWrapped on a row that continues its
 *  predecessor). Rows are padded to `cols` the way a real wrapped buffer is,
 *  and translateToString honours trimRight so the offset math is exercised
 *  exactly as it is in production. */
function fakeWrappedTerm(rows: { text: string; isWrapped: boolean }[], cols: number) {
  let provider: { provideLinks(y: number, cb: (links: FakeLink[] | undefined) => void): void } | null = null;
  const term = {
    cols,
    buffer: {
      active: {
        getLine: (i: number) => {
          const row = rows[i];
          if (!row) return null;
          return {
            isWrapped: row.isWrapped,
            // Faithful to xterm: trimRight drops only cells that were never
            // written, so a space the fixture itself contains survives. A
            // fake that trimmed those too hid a real bug (a fragment padded
            // by the TUI never looked flush with the end of its row).
            translateToString: (trimRight?: boolean) =>
              trimRight ? row.text : row.text.padEnd(cols, " "),
          };
        },
      },
    },
    registerLinkProvider: (p: typeof provider) => {
      provider = p;
      return { dispose() {} };
    },
    onScroll: () => ({ dispose() {} }),
  };
  return { term, getProvider: () => provider! };
}

/** Drive the provider for an arbitrary 1-based buffer line. */
function provideAt(
  provider: () => { provideLinks(y: number, cb: (links: FakeLink[] | undefined) => void): void },
  y: number,
): Promise<FakeLink[] | undefined> {
  return new Promise((res) => provider().provideLinks(y, res));
}

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockClear();
  revealMock.mockClear();
});

describe("attachFilePathLinks", () => {
  it("links only paths the backend says exist, with correct columns and text", async () => {
    // "/a/b.ts" exists; "nope/x.ts" does not.
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === "/a/b.ts" ? "/abs/a/b.ts" : null,
    );
    const { term, getProvider } = fakeTerm("see /a/b.ts and nope/x.ts");
    attachFilePathLinks(term as never, () => "/cwd");

    const links = await provide(getProvider);
    expect(links?.length).toBe(1);
    expect(links![0].text).toBe("/a/b.ts");
    // "/a/b.ts" starts at index 4 (1-based x=5), spans 7 chars (end.x=11).
    expect(links![0].range.start.x).toBe(5);
    expect(links![0].range.end.x).toBe(11);
    expect(links![0].range.start.y).toBe(1);
  });

  it("Cmd+click opens path; Cmd+Shift+click reveals; plain click does nothing", async () => {
    invokeMock.mockResolvedValue("/abs/a/b.ts");
    const { term, getProvider } = fakeTerm("/a/b.ts");
    attachFilePathLinks(term as never, () => "/cwd");
    const links = await provide(getProvider);

    links![0].activate({ metaKey: false, shiftKey: false } as MouseEvent, "/a/b.ts");
    expect(openMock).not.toHaveBeenCalled();
    expect(revealMock).not.toHaveBeenCalled();

    links![0].activate({ metaKey: true, shiftKey: false } as MouseEvent, "/a/b.ts");
    expect(openMock).toHaveBeenCalledWith("/abs/a/b.ts");
    expect(revealMock).not.toHaveBeenCalled();

    links![0].activate({ metaKey: true, shiftKey: true } as MouseEvent, "/a/b.ts");
    expect(revealMock).toHaveBeenCalledWith("/abs/a/b.ts");
    // Cmd+Shift dispatches reveal only — it must NOT also fire openPath.
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("returns no links when the line has no paths (no backend call)", async () => {
    const { term, getProvider } = fakeTerm("just some plain words");
    attachFilePathLinks(term as never, () => "/cwd");
    const links = await provide(getProvider);
    expect(links).toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("caches resolution so a repeated path is only resolved once", async () => {
    invokeMock.mockResolvedValue("/abs/a/b.ts");
    const { term, getProvider } = fakeTerm("/a/b.ts");
    attachFilePathLinks(term as never, () => "/cwd");
    await provide(getProvider);
    await provide(getProvider);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("attachFilePathLinks across wrapped rows", () => {
  // "[image]/tmp/abcdefg/shot.png" laid out at 16 columns: the path starts at
  // offset 7 and its tail spills onto the continuation row.
  const ROWS = [
    { text: "[image]/tmp/abcd", isWrapped: false },
    { text: "efg/shot.png", isWrapped: true },
  ];
  const PATH = "/tmp/abcdefg/shot.png";

  function backendKnowsOnly(path: string) {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === path ? path : null,
    );
  }

  it("links the head of a path that wraps, clipped to the row end", async () => {
    backendKnowsOnly(PATH);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 16);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(PATH);
    expect(links![0].range).toEqual({
      start: { x: 8, y: 1 },
      end: { x: 16, y: 1 },
    });
  });

  it("links the tail of a wrapped path on its continuation row", async () => {
    backendKnowsOnly(PATH);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 16);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 2);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(PATH);
    expect(links![0].range).toEqual({
      start: { x: 1, y: 2 },
      end: { x: 12, y: 2 },
    });
  });

  it("opens the whole wrapped path, not the fragment on the clicked row", async () => {
    backendKnowsOnly(PATH);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 16);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 2);
    links![0].activate({ metaKey: true, shiftKey: false } as MouseEvent, PATH);
    expect(openMock).toHaveBeenCalledWith(PATH);
  });

  it("does not stitch rows that are not continuations", async () => {
    // Two independent rows: the second is a real line of its own, so the
    // truncated head on row 1 must not be joined to it.
    invokeMock.mockResolvedValue(null);
    const { term, getProvider } = fakeWrappedTerm(
      [
        { text: "[image]/tmp/abcd", isWrapped: false },
        { text: "efg/shot.png", isWrapped: false },
      ],
      16,
    );
    attachFilePathLinks(term as never, () => null);

    await provideAt(getProvider, 1);
    const asked = invokeMock.mock.calls.map((c) => (c[1] as { raw: string }).raw);
    expect(asked).not.toContain(PATH);
  });
});

describe("attachFilePathLinks image hover preview", () => {
  const shot = "/tmp/shot.png";

  function withPreview(lineText: string) {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === shot ? shot : null,
    );
    const preview = { show: vi.fn().mockResolvedValue(undefined), hide: vi.fn() };
    const { term, getProvider } = fakeTerm(lineText);
    attachFilePathLinks(term as never, () => null, preview);
    return { preview, getProvider };
  }

  it("previews an image path at the pointer on hover", async () => {
    const { preview, getProvider } = withPreview("wrote /tmp/shot.png");
    const links = await provide(getProvider);

    links![0].hover!({ clientX: 120, clientY: 340 } as MouseEvent, shot);

    expect(preview.show).toHaveBeenCalledWith(shot, { x: 120, y: 340 });
  });

  it("takes the preview down when the pointer leaves", async () => {
    const { preview, getProvider } = withPreview("wrote /tmp/shot.png");
    const links = await provide(getProvider);

    links![0].leave!({} as MouseEvent, shot);

    expect(preview.hide).toHaveBeenCalled();
  });

  it("leaves non-image paths without a preview", async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === "/tmp/notes.md" ? "/tmp/notes.md" : null,
    );
    const preview = { show: vi.fn().mockResolvedValue(undefined), hide: vi.fn() };
    const { term, getProvider } = fakeTerm("see /tmp/notes.md");
    attachFilePathLinks(term as never, () => null, preview);

    const links = await provide(getProvider);
    expect(links).toHaveLength(1);
    expect(links![0].hover).toBeUndefined();
  });

  it("hides the preview when the path is opened", async () => {
    // Otherwise the popover outlives the click and hangs over the terminal
    // while Preview opens on top.
    const { preview, getProvider } = withPreview("wrote /tmp/shot.png");
    const links = await provide(getProvider);

    links![0].activate({ metaKey: true, shiftKey: false } as MouseEvent, shot);

    expect(preview.hide).toHaveBeenCalled();
  });

  it("works with no preview wired at all", async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === shot ? shot : null,
    );
    const { term, getProvider } = fakeTerm("wrote /tmp/shot.png");
    attachFilePathLinks(term as never, () => null);

    const links = await provide(getProvider);
    expect(links).toHaveLength(1);
    expect(() => links![0].hover?.({} as MouseEvent, shot)).not.toThrow();
  });

  it("registers exactly one scroll listener", async () => {
    // Two registrations would hide twice per scroll and bump the supersede
    // counter twice, cancelling a fetch that had every right to finish.
    const preview = { show: vi.fn().mockResolvedValue(undefined), hide: vi.fn() };
    const { term, scrollListenerCount } = fakeTerm("wrote /tmp/shot.png");
    attachFilePathLinks(term as never, () => null, preview);

    expect(scrollListenerCount()).toBe(1);
  });

  it("takes the preview down when the buffer scrolls under the pointer", async () => {
    // xterm fires `leave` on mouse-out and on a position change, but not when
    // the wheel moves the buffer under a stationary pointer, which would leave
    // a thumbnail hanging over unrelated output.
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === shot ? shot : null,
    );
    const preview = { show: vi.fn().mockResolvedValue(undefined), hide: vi.fn() };
    const { term, getProvider, scroll } = fakeTerm("wrote /tmp/shot.png");
    attachFilePathLinks(term as never, () => null, preview);
    const links = await provide(getProvider);
    links![0].hover!({ clientX: 1, clientY: 1 } as MouseEvent, shot);

    scroll();

    expect(preview.hide).toHaveBeenCalled();
  });
});

describe("attachFilePathLinks across a hanging-indent soft wrap", () => {
  // What Claude Code actually prints for an image attachment: it breaks the
  // path at the terminal width itself and indents the remainder, so xterm
  // marks neither row wrapped.
  const ROWS = [
    { text: "  \u203a [image]/tmp/kimbo/scratch/n", isWrapped: false },
    { text: "        ew-desktop.png      (109KB)", isWrapped: false },
  ];
  const FULL = "/tmp/kimbo/scratch/new-desktop.png";

  function backendKnowsOnly(...paths: string[]) {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      paths.includes(args.raw) ? args.raw : null,
    );
  }

  it("links the head fragment to the whole joined path", async () => {
    backendKnowsOnly(FULL);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(FULL);
    expect(links![0].range).toEqual({
      start: { x: 12, y: 1 },
      end: { x: 31, y: 1 },
    });
  });

  it("links the indented remainder on the second row", async () => {
    backendKnowsOnly(FULL);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 2);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(FULL);
    expect(links![0].range).toEqual({
      start: { x: 9, y: 2 },
      end: { x: 22, y: 2 },
    });
  });

  it("opens the joined path from either row", async () => {
    backendKnowsOnly(FULL);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 2);
    links![0].activate({ metaKey: true, shiftKey: false } as MouseEvent, FULL);

    expect(openMock).toHaveBeenCalledWith(FULL);
  });

  it("leaves a fragment alone when it is a real path in its own right", async () => {
    // "cat /etc" followed by an indented "/hosts" must not become a link to
    // /etc/hosts. A tail that resolves was printed whole, not broken.
    backendKnowsOnly("/etc", "/etc/hosts");
    const { term, getProvider } = fakeWrappedTerm(
      [
        { text: "cat /etc", isWrapped: false },
        { text: "    /hosts", isWrapped: false },
      ],
      40,
    );
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links!.map((l) => l.text)).toEqual(["/etc"]);
  });

  it("previews a joined image path on hover", async () => {
    backendKnowsOnly(FULL);
    const preview = { show: vi.fn().mockResolvedValue(undefined), hide: vi.fn() };
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null, preview);

    const links = await provideAt(getProvider, 2);
    links![0].hover!({ clientX: 5, clientY: 6 } as MouseEvent, FULL);

    expect(preview.show).toHaveBeenCalledWith(FULL, { x: 5, y: 6 });
  });
});

describe("attachFilePathLinks across a three-row soft wrap", () => {
  // The same Claude Code attachment in a narrow split pane: the path is broken
  // twice, so the middle row is a fragment with no path-like shape of its own.
  const ROWS = [
    { text: "  \u203a [image]/tmp/kimbo/scra", isWrapped: false },
    { text: "        tch/new-desk", isWrapped: false },
    { text: "        top.png      (109KB)", isWrapped: false },
  ];
  const FULL = "/tmp/kimbo/scratch/new-desktop.png";

  function backendKnowsOnly(path: string) {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === path ? path : null,
    );
  }

  it("links the middle fragment to the whole path", async () => {
    backendKnowsOnly(FULL);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 2);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(FULL);
    expect(links![0].range).toEqual({
      start: { x: 9, y: 2 },
      end: { x: 20, y: 2 },
    });
  });

  it("links the last fragment to the whole path", async () => {
    backendKnowsOnly(FULL);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 3);
    expect(links).toHaveLength(1);
    expect(links![0].range).toEqual({
      start: { x: 9, y: 3 },
      end: { x: 15, y: 3 },
    });
  });

  it("links the first fragment to the whole path", async () => {
    backendKnowsOnly(FULL);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(FULL);
  });

  it("links a fragment the TUI padded with trailing spaces", async () => {
    const rows = [
      { text: "  \u203a [image]/tmp/kimbo/scratch/n     ", isWrapped: false },
      { text: "        ew-desktop.png      (109KB)", isWrapped: false },
    ];
    const full = "/tmp/kimbo/scratch/new-desktop.png";
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === full ? full : null,
    );
    const { term, getProvider } = fakeWrappedTerm(rows, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(full);
  });
});

describe("attachFilePathLinks when a shorter prefix is also a real path", () => {
  // Every "/"-boundary prefix of a real path is a real directory, so a break
  // that lands on one made the join resolve early: the link opened the
  // containing folder, the hover showed nothing (a directory is not an image)
  // and the last row of the path went dead.
  const ROWS = [
    { text: "  \u203a [image]/tmp/kimbo/Doc", isWrapped: false },
    { text: "        uments/screenshots", isWrapped: false },
    { text: "        /a.png      (28KB)", isWrapped: false },
  ];
  const DIR = "/tmp/kimbo/Documents/screenshots";
  const FILE = "/tmp/kimbo/Documents/screenshots/a.png";

  function backendKnows(...paths: string[]) {
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      paths.includes(args.raw) ? args.raw : null,
    );
  }

  it("links the whole file, not the folder that resolves first", async () => {
    backendKnows(DIR, FILE);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links!.map((l) => l.text)).toEqual([FILE]);
  });

  it("still links the last row of such a path", async () => {
    backendKnows(DIR, FILE);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 3);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(FILE);
  });

  it("falls back to the folder when that is all there is", async () => {
    // Nothing longer exists, so the directory is the honest answer.
    backendKnows(DIR);
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    const links = await provideAt(getProvider, 1);
    expect(links!.map((l) => l.text)).toEqual([DIR]);
  });
});

describe("attachFilePathLinks link precedence and lookup cost", () => {
  const ROWS = [
    { text: "  \u203a [image]/tmp/aaa/Doc", isWrapped: false },
    { text: "        uments/x.png", isWrapped: false },
  ];
  const JOINED = "/tmp/aaa/Documents/x.png";

  it("prefers the joined path over a fragment that also exists in the cwd", async () => {
    // The continuation row's own token can be a real relative path. xterm uses
    // the first link it finds for a position and drops the rest, so if the
    // fragment came first, Cmd+click opened the wrong file.
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) => {
      if (args.raw === JOINED) return JOINED;
      if (args.raw === "uments/x.png") return "/cwd/uments/x.png";
      return null;
    });
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => "/cwd");

    const links = await provideAt(getProvider, 2);
    expect(links![0].text).toBe(JOINED);
  });

  it("looks paths up concurrently, not one round trip after another", async () => {
    // A first hover on a deep chain tests every prefix. Serially that is a
    // visible stall before the underline appears.
    let inFlight = 0;
    let peak = 0;
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return args.raw === JOINED ? JOINED : null;
    });
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    await provideAt(getProvider, 1);

    expect(peak).toBeGreaterThan(1);
  });

  it("stops looking once a chain has produced a link", async () => {
    // Every row of an indent block looks like it could start a chain, so
    // without an early exit a deep block multiplies the lookups by its height.
    invokeMock.mockImplementation(async (_cmd: string, args: { raw: string }) =>
      args.raw === JOINED ? JOINED : null,
    );
    const { term, getProvider } = fakeWrappedTerm(ROWS, 40);
    attachFilePathLinks(term as never, () => null);

    await provideAt(getProvider, 1);
    const asked = invokeMock.mock.calls.map((c) => (c[1] as { raw: string }).raw);

    // The tag variant "image]/tmp/aaa/Doc" and the real one, each with its one
    // continuation, plus the plain pass over the row itself.
    expect(asked.length).toBeLessThanOrEqual(6);
  });
});
