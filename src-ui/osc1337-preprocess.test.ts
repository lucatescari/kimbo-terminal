import { describe, it, expect } from "vitest";
import { Osc1337CursorAdvancer } from "./osc1337-preprocess";

// Fake base64 payload — the preprocessor never decodes bytes, it just
// needs some content between ":" and the OSC terminator.
const B64 = "YWJjZA==";

// Build a complete OSC 1337 inline-image sequence with BEL terminator.
function osc(attrs: string, data: string = B64, term: "\x07" | "\x1b\\" = "\x07"): string {
  return `\x1b]1337;File=${attrs}:${data}${term}`;
}

describe("Osc1337CursorAdvancer pass-through", () => {
  it("returns plain text unchanged", () => {
    const adv = new Osc1337CursorAdvancer();
    expect(adv.transform("hello world\r\n")).toBe("hello world\r\n");
  });

  it("returns non-1337 OSC sequences unchanged", () => {
    const adv = new Osc1337CursorAdvancer();
    // OSC 8 hyperlink (not 1337) should not be rewritten.
    const input = "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\";
    expect(adv.transform(input)).toBe(input);
  });

  it("returns OSC 1337 with no File= prefix unchanged", () => {
    const adv = new Osc1337CursorAdvancer();
    const input = "\x1b]1337;CurrentDir=/tmp\x07";
    expect(adv.transform(input)).toBe(input);
  });
});

describe("Osc1337CursorAdvancer injection for cell-sized images", () => {
  it("injects `\\r\\n` * height after the OSC when width and height are integer cells", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=28;height=9");
    const out = adv.transform(`before${o}after`);
    expect(out).toBe(`before${o}${"\r\n".repeat(9)}after`);
  });

  it("works with ST (ESC backslash) terminator as well as BEL", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=10;height=3", B64, "\x1b\\");
    const out = adv.transform(`x${o}y`);
    expect(out).toBe(`x${o}${"\r\n".repeat(3)}y`);
  });

  it("preserves attribute order and unknown keys", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("name=Zm9vLnBuZw==;inline=1;width=28;height=9;preserveAspectRatio=0");
    const out = adv.transform(o);
    expect(out).toBe(o + "\r\n".repeat(9));
  });

  it("handles multiple cell-sized OSCs in one chunk", () => {
    const adv = new Osc1337CursorAdvancer();
    const o1 = osc("inline=1;width=28;height=9");
    const o2 = osc("inline=1;width=10;height=4");
    const out = adv.transform(`${o1}text${o2}`);
    expect(out).toBe(`${o1}${"\r\n".repeat(9)}text${o2}${"\r\n".repeat(4)}`);
  });
});

describe("Osc1337CursorAdvancer non-injection cases", () => {
  it("does not inject for px dimensions", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=400px;height=200px");
    expect(adv.transform(o)).toBe(o);
  });

  it("does not inject for percent dimensions", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=50%;height=auto");
    expect(adv.transform(o)).toBe(o);
  });

  it("does not inject for auto dimensions", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=auto;height=auto");
    expect(adv.transform(o)).toBe(o);
  });

  it("does not inject when only width is cell-sized", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=28;height=auto");
    expect(adv.transform(o)).toBe(o);
  });

  it("does not inject when only height is cell-sized", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=auto;height=9");
    expect(adv.transform(o)).toBe(o);
  });

  it("does not inject for zero or negative cell counts", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=0;height=9");
    expect(adv.transform(o)).toBe(o);
  });
});

describe("Osc1337CursorAdvancer chunk straddling", () => {
  it("holds back the incomplete OSC until the terminator arrives", () => {
    const adv = new Osc1337CursorAdvancer();
    // First chunk: plain text + start of OSC (no terminator yet).
    const oscHead = `\x1b]1337;File=inline=1;width=28;height=9:${B64.slice(0, 3)}`;
    const oscTail = `${B64.slice(3)}\x07`;
    const out1 = adv.transform(`prefix${oscHead}`);
    // Preprocessor must not emit the incomplete OSC yet — the downstream
    // parser would try to consume it as truncated and discard our
    // injection point.
    expect(out1).toBe("prefix");
    const out2 = adv.transform(oscTail);
    expect(out2).toBe(`${oscHead}${oscTail}${"\r\n".repeat(9)}`);
  });

  it("holds back across many small chunks", () => {
    const adv = new Osc1337CursorAdvancer();
    const full = osc("inline=1;width=28;height=9");
    // Split into 16-byte chunks.
    const pieces: string[] = [];
    for (let i = 0; i < full.length; i += 16) pieces.push(full.slice(i, i + 16));
    const emitted = pieces.map((p) => adv.transform(p));
    const concatenated = emitted.join("");
    expect(concatenated).toBe(`${full}${"\r\n".repeat(9)}`);
  });

  it("resumes normal pass-through after an incomplete OSC completes", () => {
    const adv = new Osc1337CursorAdvancer();
    const o = osc("inline=1;width=28;height=9");
    const mid = Math.floor(o.length / 2);
    const out1 = adv.transform(o.slice(0, mid));
    const out2 = adv.transform(o.slice(mid) + "tail\r\n");
    expect(out1 + out2).toBe(`${o}${"\r\n".repeat(9)}tail\r\n`);
  });

  it("reset() clears pending state", () => {
    const adv = new Osc1337CursorAdvancer();
    adv.transform("\x1b]1337;File=inline=1;width=28;height=9:"); // incomplete
    adv.reset();
    // Next input must not be glued onto the stale pending buffer.
    expect(adv.transform("hello")).toBe("hello");
  });
});
