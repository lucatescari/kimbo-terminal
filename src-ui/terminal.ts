import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SerializeAddon } from "@xterm/addon-serialize";
import { openUrl } from "@tauri-apps/plugin-opener";
import { restoredSeparator } from "./closed-tabs";
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

/** Compose the auxiliary "claude was running here · resume: …" line
 *  written beneath the existing restoredSeparator() on tab reopen.
 *  Exported so the contract can be unit-tested without bringing up xterm.
 *
 *  Foreground-only gray (256-color 245). Avoids `\x1b[2m` (DIM) and
 *  `\x1b[3m` (italic) — both set bits in xterm.js's BG word, which
 *  triggers the WebGL renderer to paint an opaque rectangle behind the
 *  cell. On a translucent terminal that reads as a solid black bar
 *  through the otherwise-transparent viewport. See ansi-bg-transparent.ts
 *  for the DIM half of the same bug; italic has the same shape but no
 *  app-wide filter (stripping italic would regress every CLI that uses
 *  it for emphasis). FG-only color sidesteps the renderer path entirely. */
export function restoredClaudeResumeLine(resume: { uuid: string }): string {
  return `\x1b[38;5;245m   \u21B3 claude was running here \u00B7 resume: claude --resume ${resume.uuid}\x1b[0m\r\n`;
}

export interface TerminalSession {
  id: number;
  ptyId: number;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  container: HTMLElement;
  /** Last cwd reported via OSC 7. Null until the first OSC 7 arrives. */
  cwd: string | null;
  /** Snapshot the scrollback + viewport as ANSI text (colors, cursor
   *  position, attributes preserved). Used by closed-tab restore. */
  serialize(): string;
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
  restoredScrollback?: string,
  restoredClaudeResume?: { uuid: string },
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
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
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

  // Force a synchronous layout pass so fit.fit() below sees the real
  // viewport size BEFORE we write scrollback. createLeaf is responsible
  // for attaching parentEl to the DOM before calling us (see panes.ts);
  // appendChild alone doesn't compute layout — reading a layout-trigger
  // property does. Without this, fit.fit() runs against the
  // not-yet-laid-out container and falls back to xterm's default 80x24,
  // which would make the scrollback replay below wrap at 80 cols and
  // stay wrapped (xterm doesn't reflow rendered scrollback on resize).
  void container.offsetWidth;
  try { fit.fit(); } catch (e) { console.warn("initial fit before replay:", e); }

  // Replay closed-tab scrollback BEFORE the PTY listener attaches AND before
  // OSC handlers register below. xterm processes term.write synchronously
  // into its parser, so the bytes hit the buffer before any callback
  // (PTY, OSC 7 cwd, OSC 0/2 title, OSC 133 shell-integration) can fire.
  // Old OSC sequences embedded in the scrollback are parsed-and-ignored
  // as visual decoration since their handlers don't exist yet — we don't
  // want stale OSC events firing during replay. The if-check skips the
  // separator for empty captures so a never-used pane reopens blank.
  if (restoredScrollback) {
    term.write(restoredScrollback);
    term.write(restoredSeparator());
    if (restoredClaudeResume) {
      term.write(restoredClaudeResumeLine(restoredClaudeResume));
    }
  }

  // GPU renderer for smoother fast output. Falls back to canvas/DOM
  // automatically if WebGL isn't available (e.g., headless test env, GPU
  // context lost on display sleep).
  //
  // WKWebView often fires WebGL context loss when the window is backgrounded.
  // We dispose the addon on loss (xterm requirement), but we must load a new
  // WebglAddon when the user returns — otherwise the session stays on the
  // Canvas renderer permanently and translucent/DIM compositing no longer
  // matches the stream filter in ansi-bg-transparent.ts.
  let webglAddon: WebglAddon | null = null;

  const tryLoadWebglAddon = (): void => {
    if (webglAddon) return;
    try {
      const w = new WebglAddon();
      w.onContextLoss(() => {
        webglAddon = null;
        try {
          w.dispose();
        } catch {
          /* ignore */
        }
      });
      term.loadAddon(w);
      webglAddon = w;
    } catch (e) {
      console.warn("WebGL renderer unavailable, falling back to default:", e);
    }
  };

  tryLoadWebglAddon();

  const restoreWebglAfterContextLoss = (): void => {
    if (document.visibilityState !== "visible") return;
    // Defer one frame: WKWebView sometimes isn't ready to create a new GL
    // context synchronously on the same tick as focus/visibility.
    requestAnimationFrame(() => {
      tryLoadWebglAddon();
      fit.fit();
    });
  };
  window.addEventListener("focus", restoreWebglAfterContextLoss);
  document.addEventListener("visibilitychange", restoreWebglAfterContextLoss);

  /** Native window focus — DOM `window` focus does not always track Cmd-Tab in Tauri/WKWebView. */
  let unlistenTauriFocus: (() => void) | undefined;
  try {
    // `getCurrentWindow()` reads `__TAURI_INTERNALS__.metadata` and throws
    // synchronously when the bridge isn't installed (vitest browser tests).
    // The trailing `.catch` only handles `onFocusChanged`'s promise — it
    // does NOT swallow the synchronous throw, so wrap the whole thing.
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) restoreWebglAfterContextLoss();
      })
      .then((unlisten) => {
        unlistenTauriFocus = unlisten;
      })
      .catch(() => {
        /* onFocusChanged rejected (event channel not ready). */
      });
  } catch {
    /* No Tauri bridge (e.g. vitest browser tests). */
  }

  registerTerminal(term);
  // The .pane element is already in the document (panes.ts:createLeaf
  // attaches it before awaiting us) and we forced layout above with
  // offsetWidth, so this fit.fit() now lands at the real viewport size
  // — the previous behaviour of falling back to xterm's 80x24 default
  // is gone. The ResizeObserver below still catches subsequent window
  // resizes / split-handle drags.
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
  const disposeInlineImages = attachOsc1337Renderer(term, container);

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
    serialize() {
      return serialize.serialize();
    },
    dispose() {
      // Kill the backend PTY FIRST, before any UI teardown that could throw.
      // term.dispose() (xterm + WebGL) is known to throw on GPU context loss
      // — putting closePty after it meant a thrown teardown stranded the
      // kill, leaving npm/node children alive. Each subsequent step is also
      // wrapped in its own try/catch so one failure can't stop the next.
      // closePty is fire-and-forget here: the Tauri invoke message reaches
      // Rust whether or not the JS Promise is awaited, so dispose() stays
      // synchronous and callers don't have to change.
      closePty(ptyId).catch((e) => console.warn("closePty failed:", e));

      try { disposeInlineImages(); } catch (e) { console.warn("disposeInlineImages:", e); }
      try { window.removeEventListener("focus", restoreWebglAfterContextLoss); } catch (e) { console.warn("window remove focus listener:", e); }
      try { document.removeEventListener("visibilitychange", restoreWebglAfterContextLoss); } catch (e) { console.warn("document remove visibilitychange listener:", e); }
      try { unlistenTauriFocus?.(); } catch (e) { console.warn("unlistenTauriFocus:", e); }
      try { onDataDisposable.dispose(); } catch (e) { console.warn("onDataDisposable.dispose:", e); }
      try { onResizeDisposable.dispose(); } catch (e) { console.warn("onResizeDisposable.dispose:", e); }
      try { unlistenOutput(); } catch (e) { console.warn("unlistenOutput:", e); }
      try { unlistenExit(); } catch (e) { console.warn("unlistenExit:", e); }
      try { unregisterTerminal(term); } catch (e) { console.warn("unregisterTerminal:", e); }
      try { fitObserver.disconnect(); } catch (e) { console.warn("fitObserver.disconnect:", e); }
      try { viewport?.removeEventListener("scroll", onViewportScroll); } catch (e) { console.warn("viewport remove scroll listener:", e); }
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
      try { term.dispose(); } catch (e) { console.warn("term.dispose:", e); }
      try { container.remove(); } catch (e) { console.warn("container.remove:", e); }
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
