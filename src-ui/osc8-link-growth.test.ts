import { describe, it, expect } from "vitest";
import { attachOsc8Links } from "./osc8";

// Regression: OSC 8 hyperlinks (emitted constantly by `ls --hyperlink`, `eza`,
// `git`, `claude`) were tracked in a per-Terminal array that NEVER pruned.
// Over a long session the array grew into the tens of thousands, and the
// xterm.js link provider walked the whole array on every hover-triggered
// `provideLinks` call (flatMap over N entries × visible lines). The user
// perceived this as input lag that "grows with extended use" — every frame
// budget got eaten by the link scan, delaying the render of the echoed
// keystroke.
//
// These tests pin the contract that fixes that:
//   1. The tracker exposes its current size so we can measure it.
//   2. After more emissions than the internal cap, the size stays bounded.
//   3. `provideLinks` is still fast (sub-frame budget) after a heavy session.
//
// We drive the real `attachOsc8Links` against a minimal mock Terminal that
// only implements the surface OSC 8 actually uses — no xterm.js or DOM.

interface CapturedOscHandler {
  (data: string): boolean;
}
interface CapturedLinkProvider {
  provideLinks(line: number, cb: (links: unknown[]) => void): void;
}

function makeMockTerm() {
  const cursor = { baseY: 0, cursorY: 0, cursorX: 0 };
  let osc8: CapturedOscHandler | null = null;
  let provider: CapturedLinkProvider | null = null;

  const term = {
    cols: 80,
    buffer: { active: cursor },
    parser: {
      registerOscHandler(code: number, handler: CapturedOscHandler) {
        if (code === 8) osc8 = handler;
        return { dispose() {} };
      },
    },
    registerLinkProvider(p: CapturedLinkProvider) {
      provider = p;
      return { dispose() {} };
    },
  };

  // Helper: emit one full OSC 8 hyperlink (open + close) at the current cursor.
  function emitHyperlink(url: string): void {
    if (!osc8) throw new Error("osc8 handler not registered");
    osc8(`1;${url}`);          // open
    cursor.cursorX += 10;       // simulate text written between open and close
    osc8("");                    // close
    cursor.baseY += 1;           // simulate next prompt line so each link sits on its own row
    cursor.cursorX = 0;
  }

  function callProvideLinks(line: number): number {
    if (!provider) throw new Error("link provider not registered");
    let count = 0;
    provider.provideLinks(line, (links) => { count = links.length; });
    return count;
  }

  return { term, emitHyperlink, callProvideLinks, cursor };
}

describe("OSC 8 link tracker bounded growth (regression: input lag grew over a long session)", () => {
  it("exposes a size accessor on the handle returned from attachOsc8Links", () => {
    const { term } = makeMockTerm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = attachOsc8Links(term as any, () => {});
    expect(handle).toBeDefined();
    expect(typeof handle.size).toBe("function");
    expect(handle.size()).toBe(0);
  });

  it("caps the internal range array even after tens of thousands of OSC 8 sequences", () => {
    const { term, emitHyperlink } = makeMockTerm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = attachOsc8Links(term as any, () => {});

    // Simulate a heavy session: 20k OSC 8 hyperlinks (typical of `eza` /
    // `ls --hyperlink` invocations across an afternoon).
    for (let i = 0; i < 20_000; i++) emitHyperlink(`https://example.com/${i}`);

    // Pre-fix this returned 20000 (unbounded). The cap stops it.
    expect(handle.size()).toBeLessThanOrEqual(5_000);
    // Sanity: we did actually accept SOME of them (so the test isn't trivially
    // passing because OSC handling was broken).
    expect(handle.size()).toBeGreaterThan(0);
  });

  it("provideLinks stays fast after a heavy OSC 8 session (frame-budget regression)", () => {
    const { term, emitHyperlink, callProvideLinks } = makeMockTerm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachOsc8Links(term as any, () => {});

    for (let i = 0; i < 20_000; i++) emitHyperlink(`https://example.com/${i}`);

    // Warm up V8/JIT so the timed runs reflect steady-state cost, not cold
    // compilation.
    for (let n = 0; n < 100; n++) callProvideLinks(1);

    // Hover events make xterm call provideLinks per visible line. Simulate a
    // brief mouse movement across the viewport. Wall-clock timing is noisy on
    // shared CI runners (a transient load spike once pushed this to ~508ms),
    // so take the BEST of a few runs — a spike inflates individual runs but
    // not the minimum — and leave generous headroom.
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      for (let n = 0; n < 1000; n++) callProvideLinks(1);
      best = Math.min(best, performance.now() - start);
    }

    // Pre-fix: 1000 calls * 20000 ranges = 2×10^7 flatMap ops (~1–2s locally,
    // ~2s+ on slow CI). Post-fix: 1000 * ≤5000 = 5×10^6 ops — well under 100ms
    // locally. The deterministic size-cap test above is the primary regression
    // guard; this only needs to fail on a gross blow-up, so 1000ms keeps wide
    // CI headroom while still catching the 4×-work unbounded regression.
    expect(best).toBeLessThan(1000);
  });
});
