import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import { parseOsc7Cwd } from "./osc7";
export { parseOsc7Cwd } from "./osc7";
import { attachOsc8Links } from "./osc8";

export interface TerminalSession {
  id: number;
  ptyId: number;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  container: HTMLElement;
  /** Last cwd reported via OSC 7. Null until the first OSC 7 arrives. */
  cwd: string | null;
  dispose(): void;
}

let nextTermId = 1;

let tabTitleHandler: ((sessionId: number, title: string | null) => void) | null = null;
export function setTabTitleHandler(fn: (sessionId: number, title: string | null) => void): void {
  tabTitleHandler = fn;
}

export async function createTerminalSession(
  parentEl: HTMLElement,
  cwd?: string,
): Promise<TerminalSession> {
  const id = nextTermId++;

  // Declare session here so the OSC 7 handler below can close over it and
  // write session.cwd before the object is returned to the caller.
  let session: TerminalSession;

  const opts = getTerminalOptions();
  const term = new Terminal({
    cursorBlink: opts.cursorBlink,
    cursorStyle: opts.cursorStyle,
    fontSize: opts.fontSize,
    fontFamily: normalizeFontFamily(opts.fontFamily),
    lineHeight: opts.lineHeight,
    scrollback: opts.scrollback,
    theme: {},
    // Unicode11Addon and registerLinkProvider (OSC 8) both touch proposed
    // xterm.js APIs, which refuse to activate without this opt-in flag.
    allowProposedApi: true,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      if (!event.metaKey) return;
      openUrl(uri).catch((e) => console.error("openUrl failed:", e));
    }),
  );

  // Create container.
  const container = document.createElement("div");
  container.className = "terminal-container";
  container.style.width = "100%";
  container.style.height = "100%";
  parentEl.appendChild(container);

  // Modern emoji (🏳️‍🌈, ZWJ sequences, skin tones) need Unicode 11 widths
  // to align correctly. Without this, xterm uses Unicode 6 widths from 1991.
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";

  term.open(container);

  // GPU renderer for smoother fast output. Falls back to canvas/DOM
  // automatically if WebGL isn't available (e.g., headless test env, GPU
  // context lost on display sleep).
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch (e) {
    console.warn("WebGL renderer unavailable, falling back to default:", e);
  }

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

  // OSC 0 and OSC 2: shell or running program sets the tab title.
  // Empty payload reverts to the default. Truncate to 64 chars to bound
  // memory if a TUI accidentally sends a megabyte.
  const onTitle = (data: string): boolean => {
    if (tabTitleHandler) tabTitleHandler(id, data ? data.slice(0, 64) : null);
    return true;
  };
  term.parser.registerOscHandler(0, onTitle);
  term.parser.registerOscHandler(2, onTitle);

  // OSC 7: shells emit file://hostname/path on each prompt so terminals
  // can know the current working directory without polling /proc.
  term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7Cwd(data);
    if (cwd) session.cwd = cwd;
    return true;
  });

  // OSC 8: tools like ls --hyperlink, eza, bat, git, Claude Code emit
  // semantic hyperlinks. Same Cmd-gated activation as the URL auto-detector.
  attachOsc8Links(term, (event, uri) => {
    if (!event.metaKey) return;
    openUrl(uri).catch((e) => console.error("openUrl failed:", e));
  });

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
      // preventDefault() stops the browser from inserting a newline into
      // xterm's hidden helper-textarea — without it, xterm's input handler
      // fires later and emits a rogue \r through term.onData, which the
      // shell/TUI sees as "submit" appended to our \x1b\r.
      ev.preventDefault();
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

  // macOS-style auto-hiding scrollbar: add .scrolling to the container
  // while the viewport is actively being scrolled, remove after a short
  // idle window. CSS fades the thumb in and out.
  const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
  let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const onViewportScroll = () => {
    container.classList.add("scrolling");
    if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      container.classList.remove("scrolling");
      scrollIdleTimer = null;
    }, 800);
  };
  viewport?.addEventListener("scroll", onViewportScroll, { passive: true });

  session = {
    id,
    ptyId,
    term,
    fit,
    search,
    container,
    cwd: null,
    dispose() {
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      unlistenOutput();
      unlistenExit();
      unregisterTerminal(term);
      viewport?.removeEventListener("scroll", onViewportScroll);
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
      term.dispose();
      closePty(ptyId);
      container.remove();
    },
  };

  return session;
}
