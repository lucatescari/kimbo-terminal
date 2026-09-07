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
}

/** Minimal xterm stand-in: one buffer line, captures the link provider. */
function fakeTerm(lineText: string) {
  let provider: { provideLinks(y: number, cb: (links: FakeLink[] | undefined) => void): void } | null = null;
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
  };
  return { term, getProvider: () => provider! };
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
          const padded = row.text.padEnd(cols, " ");
          return {
            isWrapped: row.isWrapped,
            translateToString: (trimRight?: boolean) =>
              trimRight ? padded.replace(/\s+$/, "") : padded,
          };
        },
      },
    },
    registerLinkProvider: (p: typeof provider) => {
      provider = p;
      return { dispose() {} };
    },
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
