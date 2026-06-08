// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const revealMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
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

beforeEach(() => {
  invokeMock.mockReset();
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

  it("Cmd+click reveals the resolved path; plain click does not", async () => {
    invokeMock.mockResolvedValue("/abs/a/b.ts");
    const { term, getProvider } = fakeTerm("/a/b.ts");
    attachFilePathLinks(term as never, () => "/cwd");
    const links = await provide(getProvider);

    links![0].activate({ metaKey: false } as MouseEvent, "/a/b.ts");
    expect(revealMock).not.toHaveBeenCalled();

    links![0].activate({ metaKey: true } as MouseEvent, "/a/b.ts");
    expect(revealMock).toHaveBeenCalledWith("/abs/a/b.ts");
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
