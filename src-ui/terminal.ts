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
import { attachOsc1337Renderer } from "./osc1337-renderer";
import { Osc1337CursorAdvancer } from "./osc1337-preprocess";
import { stripAnsiBlackBg } from "./ansi-bg-transparent";
import { getPrefs } from "./ui-prefs";

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
    // Let the terminal background show through so the alpha on #app-frame
    // (driven by --app-alpha) and the macOS NSVisualEffectView behind the
    // webview are visible inside the terminal viewport. Without this, xterm's
    // WebGL renderer paints an opaque fill using theme.background and masks
    // the window-level translucency.
    allowTransparency: true,
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
  // Height is flex-managed by the pane (pane is flex-column with .pane-head on
  // top and .terminal-container taking the remaining space). A hardcoded 100%
  // would overflow past the pane-head strip.
  container.style.flex = "1";
  container.style.minHeight = "0";
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
  // NOTE: the element passed to us by createLeaf is still detached from the
  // document at this point, and only gets appended once createLeaf returns
  // (see panes.ts:createRootPane and splitActive). A sync fit.fit() here
  // runs on a 0×0 container and wedges xterm at the 80×24 default, which
  // then goes straight to the PTY and locks TUIs like Claude Code at that
  // size until the next window resize. The ResizeObserver below fires as
  // soon as the container is attached AND laid out — that's the first
  // moment fit.fit() has real dimensions to work with. We still call fit
  // sync so xterm has SOME size before the PTY is created; the RO will
  // correct it on first real layout.
  fit.fit();
  const fitObserver = new ResizeObserver((entries) => {
    // Ignore spurious 0×0 ticks (detached → attached transitions emit one
    // before layout lands in some browsers). Only fit when we have real
    // dimensions to work with.
    for (const e of entries) {
      const r = e.contentRect;
      if (r.width > 0 && r.height > 0) {
        fit.fit();
        break;
      }
    }
  });
  fitObserver.observe(container);

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

  // OSC 1337 iTerm inline images. Rendering, lifecycle, and cleanup are
  // delegated to a dedicated module so terminal.ts stays focused on wiring.
  const disposeInlineImages = attachOsc1337Renderer(term, container, {
    onImageClick: (blobUrl) => {
      openUrl(blobUrl).catch((e) => console.error("openUrl failed:", e));
    },
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

  // Wire output: PTY -> xterm.js, with an OSC 1337 cursor-advance
  // preprocessor. The preprocessor splices `\r\n * height` after every
  // cell-sized inline image so fastfetch's subsequent `\x1b[9A` (cursor
  // up) lands on the image's top row instead of on prior scrollback. See
  // osc1337-preprocess.ts for why this can't be done from inside the OSC
  // handler (term.write there is queued after the current parser chunk).
  const osc1337Advancer = new Osc1337CursorAdvancer();
  // PTY bytes are UTF-8. We may first filter ANSI dark-background sequences
  // when the transparency preference is enabled, then decode to text and run
  // the OSC 1337 preprocessor on that text stream.
  const ptyDecoder = new TextDecoder("utf-8");
  const unlistenOutput = await onPtyOutput(ptyId, (data) => {
    dumpPtyChunkIfArmed(data, ptyId);
    const filtered = getPrefs().transparentBlackBg ? stripAnsiBlackBg(data) : data;
    const text = ptyDecoder.decode(filtered, { stream: true });
    term.write(osc1337Advancer.transform(text));
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
      disposeInlineImages();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      unlistenOutput();
      unlistenExit();
      unregisterTerminal(term);
      fitObserver.disconnect();
      viewport?.removeEventListener("scroll", onViewportScroll);
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
      term.dispose();
      closePty(ptyId);
      container.remove();
    },
  };

  return session;
}

// ---------------------------------------------------------------------------
// Diagnostic hex-dump of raw PTY bytes. Dormant until the user sets
// `localStorage.kimboDiagBurst = "N"` in devtools — the next N chunks are
// hex-dumped with an ASCII gutter. Each chunk is truncated to
// MAX_BYTES_PER_CHUNK so a chatty dev server doesn't wipe out the console.
// Used to diagnose rendering issues like the xterm DIM-attribute black-box
// that motivated the `\x1b[2m`→`\x1b[22m` rewrite.
// ---------------------------------------------------------------------------

const MAX_BYTES_PER_CHUNK = 600;

function dumpPtyChunkIfArmed(buf: Uint8Array, ptyId: number): void {
  let remaining: number;
  try {
    remaining = parseInt(localStorage.getItem("kimboDiagBurst") || "0", 10);
  } catch {
    return;
  }
  if (!Number.isFinite(remaining) || remaining <= 0) return;

  try { localStorage.setItem("kimboDiagBurst", String(remaining - 1)); } catch {}

  const slice = buf.length > MAX_BYTES_PER_CHUNK ? buf.subarray(0, MAX_BYTES_PER_CHUNK) : buf;
  // eslint-disable-next-line no-console
  console.warn(
    `[kimbo.diag.chunk ${remaining}] pty=${ptyId} len=${buf.length}` +
      (buf.length > MAX_BYTES_PER_CHUNK ? ` (truncated to ${MAX_BYTES_PER_CHUNK})` : "") +
      `\n` +
      formatHexDump(slice),
  );
}

/** 16-byte-per-row hex dump with an ASCII gutter. ESC is rendered as `.ESC`
 *  to make CSI sequences jump out; other non-printables as `.`. */
function formatHexDump(buf: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < buf.length; i += 16) {
    const chunk = buf.subarray(i, Math.min(i + 16, buf.length));
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(chunk, (b) => {
      if (b === 0x1b) return "␛";
      if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
      return ".";
    }).join("");
    rows.push(`${i.toString(16).padStart(4, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return rows.join("\n");
}
