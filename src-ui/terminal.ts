import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  createPty,
  writePty,
  resizePty,
  closePty,
  onPtyOutput,
  onPtyExit,
} from "./pty";
import { registerTerminal, unregisterTerminal, getTerminalOptions, normalizeFontFamily } from "./theme";
import { kimboBus } from "./kimbo-bus";
import { parseOsc133 } from "./kimbo-osc";
import { isKimboShellIntegrationEnabled } from "./kimbo";

export interface TerminalSession {
  id: number;
  ptyId: number;
  term: Terminal;
  fit: FitAddon;
  container: HTMLElement;
  dispose(): void;
}

let nextTermId = 1;

export async function createTerminalSession(
  parentEl: HTMLElement,
  cwd?: string,
): Promise<TerminalSession> {
  const id = nextTermId++;

  const opts = getTerminalOptions();
  const term = new Terminal({
    cursorBlink: opts.cursorBlink,
    cursorStyle: opts.cursorStyle,
    fontSize: opts.fontSize,
    fontFamily: normalizeFontFamily(opts.fontFamily),
    lineHeight: opts.lineHeight,
    scrollback: opts.scrollback,
    theme: {},
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());

  // Create container.
  const container = document.createElement("div");
  container.className = "terminal-container";
  container.style.width = "100%";
  container.style.height = "100%";
  parentEl.appendChild(container);

  term.open(container);
  registerTerminal(term);
  fit.fit();

  // Kimbo shell integration — OSC 133 command-start/end (only when enabled).
  if (isKimboShellIntegrationEnabled()) {
    term.parser.registerOscHandler(133, (data) => {
      const msg = parseOsc133(data);
      if (!msg) return false;
      if (msg.kind === "command-start") kimboBus.emit({ type: "command-start" });
      else kimboBus.emit({ type: "command-end", exit: msg.exit });
      return true;
    });
  }

  // Create backend PTY.
  const ptyId = await createPty(cwd);

  // Shift+Enter sends ESC+CR so TUIs (Claude Code, readline meta-Enter, etc.)
  // treat it as "insert newline into input" instead of "submit".
  term.attachCustomKeyEventHandler((ev) => {
    if (
      ev.type === "keydown" &&
      ev.key === "Enter" &&
      ev.shiftKey &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey
    ) {
      writePty(ptyId, "\x1b\r");
      return false;
    }
    return true;
  });

  // Wire output: PTY -> xterm.js
  const unlistenOutput = await onPtyOutput(ptyId, (data) => {
    term.write(data);
  });

  // Wire input: xterm.js -> PTY
  let lastTyped = 0;
  const onDataDisposable = term.onData((data) => {
    writePty(ptyId, data);
    const now = Date.now();
    if (now - lastTyped > 250) {
      lastTyped = now;
      kimboBus.emit({ type: "user-typed" });
    }
  });

  // Wire resize: xterm.js -> PTY
  const onResizeDisposable = term.onResize(({ cols, rows }) => {
    resizePty(ptyId, cols, rows);
  });

  // Handle shell exit.
  const unlistenExit = await onPtyExit(ptyId, () => {
    term.write("\r\n[Process exited]\r\n");
  });

  // Initial resize to sync xterm dimensions with PTY.
  resizePty(ptyId, term.cols, term.rows);

  const session: TerminalSession = {
    id,
    ptyId,
    term,
    fit,
    container,
    dispose() {
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      unlistenOutput();
      unlistenExit();
      unregisterTerminal(term);
      term.dispose();
      closePty(ptyId);
      container.remove();
    },
  };

  return session;
}
