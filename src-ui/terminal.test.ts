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
