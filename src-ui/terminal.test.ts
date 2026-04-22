import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const terminalSource = readFileSync(resolve(__dirname, "terminal.ts"), "utf-8");

describe("terminal: Shift+Enter sends meta-Enter sequence", () => {
  it("registers a custom key event handler on the xterm terminal", () => {
    expect(terminalSource).toContain("attachCustomKeyEventHandler");
  });

  it("intercepts Enter keydown with shiftKey true", () => {
    // The handler must check for Enter + shiftKey specifically. Using a
    // flexible regex so formatting changes don't break the test.
    expect(terminalSource).toMatch(/key\s*===\s*["']Enter["']/);
    expect(terminalSource).toMatch(/shiftKey/);
  });

  it("only triggers on keydown (not keyup)", () => {
    expect(terminalSource).toMatch(/type\s*===\s*["']keydown["']/);
  });

  it("requires no other modifiers (ctrl, meta, alt all false)", () => {
    expect(terminalSource).toMatch(/!.*ctrlKey/);
    expect(terminalSource).toMatch(/!.*metaKey/);
    expect(terminalSource).toMatch(/!.*altKey/);
  });

  it("writes the ESC+CR sequence to the PTY on match", () => {
    // Accept either "\x1b\r" or "\u001b\r" forms.
    expect(terminalSource).toMatch(/writePty\s*\(\s*ptyId\s*,\s*["'](?:\\x1b|\\u001b)\\r["']\s*\)/);
  });

  it("returns false from the handler to suppress xterm default", () => {
    // The handler body must include a `return false;` after the write.
    // We check that `return false` appears in the same file as the handler.
    expect(terminalSource).toContain("return false");
  });

  it("calls ev.preventDefault to stop the textarea from emitting a rogue \\r", () => {
    // Without preventDefault, the browser inserts a newline into xterm's
    // hidden helper-textarea and xterm's input handler then fires onData
    // with \r, which the shell sees as "submit" appended to our \x1b\r.
    expect(terminalSource).toMatch(/ev\.preventDefault\s*\(\s*\)/);
  });
});

describe("terminal: cmd-click URL opening", () => {
  it("imports openUrl from the opener plugin", () => {
    expect(terminalSource).toContain('from "@tauri-apps/plugin-opener"');
    expect(terminalSource).toContain("openUrl");
  });

  it("passes a handler to WebLinksAddon", () => {
    expect(terminalSource).toMatch(/new WebLinksAddon\s*\([\s\S]*?=>/);
  });

  it("gates the handler on event.metaKey", () => {
    expect(terminalSource).toMatch(/event\.metaKey|ev\.metaKey|e\.metaKey/);
  });
});

describe("terminal: WebGL renderer", () => {
  it("imports WebglAddon", () => {
    expect(terminalSource).toContain('from "@xterm/addon-webgl"');
    expect(terminalSource).toContain("WebglAddon");
  });

  it("loads WebglAddon inside a try/catch with onContextLoss handler", () => {
    expect(terminalSource).toMatch(/try\s*\{[\s\S]*?new WebglAddon/);
    expect(terminalSource).toContain("onContextLoss");
  });
});

describe("terminal: Unicode 11 widths", () => {
  it("imports Unicode11Addon", () => {
    expect(terminalSource).toContain('from "@xterm/addon-unicode11"');
    expect(terminalSource).toContain("Unicode11Addon");
  });

  it("activates Unicode 11 after loading the addon", () => {
    expect(terminalSource).toMatch(/term\.unicode\.activeVersion\s*=\s*["']11["']/);
  });
});

const tabsSource = readFileSync(resolve(__dirname, "tabs.ts"), "utf-8");

describe("terminal: OSC 0/2 tab titles", () => {
  it("registers OSC 0 and OSC 2 handlers in terminal.ts", () => {
    expect(terminalSource).toMatch(/registerOscHandler\s*\(\s*0\s*,/);
    expect(terminalSource).toMatch(/registerOscHandler\s*\(\s*2\s*,/);
  });

  it("exports setTabTitle from tabs.ts", () => {
    expect(tabsSource).toContain("export function setTabTitle");
  });

  it("setTabTitle accepts string | null", () => {
    expect(tabsSource).toMatch(/setTabTitle\s*\([^)]*string\s*\|\s*null/);
  });

  it("terminal.ts exposes setTabTitleHandler for main.ts to wire", () => {
    expect(terminalSource).toContain("setTabTitleHandler");
  });
});

import { parseOsc7Cwd } from "./osc7";

const osc7Source = readFileSync(resolve(__dirname, "osc7.ts"), "utf-8");

describe("terminal: OSC 7 cwd inheritance", () => {
  it("registers OSC 7 handler", () => {
    expect(terminalSource).toMatch(/registerOscHandler\s*\(\s*7\s*,/);
  });

  it("exports parseOsc7Cwd", () => {
    expect(osc7Source).toContain("export function parseOsc7Cwd");
  });

  it("session exposes cwd field", () => {
    expect(terminalSource).toMatch(/cwd\??\s*:\s*string/);
  });
});

describe("parseOsc7Cwd", () => {
  it("parses file://hostname/path", () => {
    expect(parseOsc7Cwd("file://machine/Users/luca/Projects")).toBe("/Users/luca/Projects");
  });

  it("parses file:///path (no hostname)", () => {
    expect(parseOsc7Cwd("file:///Users/luca")).toBe("/Users/luca");
  });

  it("URL-decodes the path", () => {
    expect(parseOsc7Cwd("file://m/Users/luca/My%20Project")).toBe("/Users/luca/My Project");
  });

  it("returns null for non-file URIs", () => {
    expect(parseOsc7Cwd("http://example.com/path")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseOsc7Cwd("")).toBeNull();
  });

  it("returns null for malformed URI", () => {
    expect(parseOsc7Cwd("not-a-uri")).toBeNull();
  });

  it("returns null when decodeURIComponent throws", () => {
    expect(parseOsc7Cwd("file:///bad%path")).toBeNull();
  });
});

import { clipLinkRangeForLine } from "./osc8";

describe("clipLinkRangeForLine", () => {
  // A single-line link: starts and ends on absolute buffer line 5 (0-based),
  // so bufferLineNumber 6 (1-based).
  const singleLine = { startY: 5, startX: 3, endY: 5, endX: 10 };

  it("returns null when the range is entirely above the requested line", () => {
    expect(clipLinkRangeForLine(singleLine, 5, 80)).toBeNull();
  });

  it("returns null when the range is entirely below the requested line", () => {
    expect(clipLinkRangeForLine(singleLine, 7, 80)).toBeNull();
  });

  it("returns exact start/end x for a single-line range", () => {
    const result = clipLinkRangeForLine(singleLine, 6, 80);
    expect(result).toEqual({
      start: { x: 4, y: 6 },  // startX 3 → 1-based = 4
      end:   { x: 10, y: 6 }, // endX 10 used directly as 1-based-inclusive
    });
  });

  // A multi-line link spanning absolute lines 5–7 (0-based).
  const multiLine = { startY: 5, startX: 3, endY: 7, endX: 6 };

  it("clips start x to 1 for a middle line of a multi-line range", () => {
    // bufferLineNumber 7 = absolute 6, which is the middle line
    const result = clipLinkRangeForLine(multiLine, 7, 80);
    expect(result).toEqual({
      start: { x: 1, y: 7 },
      end:   { x: 80, y: 7 }, // not on endY, so full width
    });
  });

  it("uses startX on the opening line of a multi-line range", () => {
    const result = clipLinkRangeForLine(multiLine, 6, 80);
    expect(result).toEqual({
      start: { x: 4, y: 6 },  // startX+1
      end:   { x: 80, y: 6 }, // not on endY, so full width
    });
  });

  it("uses endX on the closing line of a multi-line range", () => {
    const result = clipLinkRangeForLine(multiLine, 8, 80);
    expect(result).toEqual({
      start: { x: 1, y: 8 },  // not on startY, so x=1
      end:   { x: 6, y: 8 },  // endX used directly
    });
  });
});

const osc8Source = readFileSync(resolve(__dirname, "osc8.ts"), "utf-8");
const keysSource = readFileSync(resolve(__dirname, "keys.ts"), "utf-8");
const mainSource = readFileSync(resolve(__dirname, "main.ts"), "utf-8");
const findBarSource = readFileSync(resolve(__dirname, "find-bar.ts"), "utf-8");

describe("terminal: OSC 8 hyperlinks", () => {
  it("imports attachOsc8Links in terminal.ts", () => {
    expect(terminalSource).toContain('from "./osc8"');
    expect(terminalSource).toContain("attachOsc8Links");
  });

  it("calls attachOsc8Links with term and a callback", () => {
    expect(terminalSource).toMatch(/attachOsc8Links\s*\(\s*term\s*,/);
  });

  it("osc8.ts exports attachOsc8Links", () => {
    expect(osc8Source).toContain("export function attachOsc8Links");
  });

  it("osc8.ts registers OSC 8 handler", () => {
    expect(osc8Source).toMatch(/registerOscHandler\s*\(\s*8\s*,/);
  });

  it("osc8.ts registers a link provider", () => {
    expect(osc8Source).toContain("registerLinkProvider");
  });

  it("osc8 callback honors event.metaKey for activation", () => {
    expect(terminalSource).toMatch(/attachOsc8Links\s*\(\s*term\s*,\s*\([^)]*event[^)]*\)\s*=>[\s\S]*?event\.metaKey/);
  });
});

describe("terminal: OSC 1337 inline images", () => {
  it("imports attachOsc1337Renderer in terminal.ts", () => {
    expect(terminalSource).toContain('from "./osc1337-renderer"');
    expect(terminalSource).toContain("attachOsc1337Renderer");
  });

  it("wires inline renderer and dispose", () => {
    expect(terminalSource).toMatch(/attachOsc1337Renderer\s*\(/);
    expect(terminalSource).toMatch(/disposeInlineImages\s*\(\s*\)/);
  });

  it("runs PTY output through the OSC 1337 cursor-advance preprocessor", () => {
    // Required so fastfetch's `\x1b[9A` after an inline image lands on
    // the image's top row (cursor advance has to be spliced into the
    // same parser chunk as the OSC — it can't be deferred from inside
    // the OSC handler).
    expect(terminalSource).toContain('from "./osc1337-preprocess"');
    expect(terminalSource).toContain("Osc1337CursorAdvancer");
    expect(terminalSource).toMatch(/\.transform\s*\(\s*\w+\s*\)/);
  });
});

describe("terminal: Find in scrollback (Cmd+F)", () => {
  it("imports SearchAddon in terminal.ts", () => {
    expect(terminalSource).toContain('from "@xterm/addon-search"');
    expect(terminalSource).toContain("SearchAddon");
  });

  it("exposes search on TerminalSession", () => {
    expect(terminalSource).toMatch(/search\s*:\s*SearchAddon/);
  });

  it("find-bar exports initFindBar and toggleFindBar", () => {
    expect(findBarSource).toContain("export function initFindBar");
    expect(findBarSource).toContain("export function toggleFindBar");
  });

  it("main.ts calls initFindBar with the body element", () => {
    expect(mainSource).toContain("initFindBar");
  });

  it("keys.ts binds Cmd+F to toggleFindBar", () => {
    expect(keysSource).toContain("toggleFindBar");
    expect(keysSource).toMatch(/key:\s*"f".*meta:\s*true/);
  });

  it("keys.ts handles Escape to close find-bar", () => {
    expect(keysSource).toContain("isFindBarVisible");
    expect(keysSource).toContain("hideFindBar");
  });
});
