// Stream filter: rewrite ANSI "set background to black" SGR codes to "default
// background" so a translucent terminal shows the window chrome through those
// cells instead of an opaque ansi_black rectangle.
//
// Why this exists: CLIs like Vite and Tauri emit explicit bg-colored labels
// (e.g. green-on-black "Running" badges). xterm faithfully paints those
// backgrounds even when the terminal's default bg is `rgba(0,0,0,0)`, which
// shows as solid dark boxes in an otherwise-transparent viewport. Rewriting
// `\x1b[40m` to `\x1b[49m` before xterm sees the bytes makes those cells
// render with the transparent default bg while keeping their foreground.
//
// We target four forms of "black bg":
//   - 40        — ANSI standard black bg
//   - 100       — ANSI bright black bg
//   - 48;5;0    — 256-color indexed bg, index 0 = ansi_black
//   - 48;2;0;0;0 — truecolor bg rgb(0,0,0)
// Every other CSI parameter, and every non-SGR CSI, passes through untouched.
//
// The filter operates on bytes because xterm's write() path is byte-oriented
// and we don't want to introduce a stateful TextDecoder boundary. ANSI/CSI
// sequences are ASCII-only, and ASCII byte values never appear inside a
// multi-byte UTF-8 continuation (those are 0x80–0xBF), so scanning bytes for
// `ESC [ … m` patterns cannot collide with user-visible text encoded in UTF-8.

const ESC = 0x1b;
const LBRACKET = 0x5b; // '['
const M = 0x6d;         // 'm' — final byte for SGR
const SEMI = ";".charCodeAt(0);
const ZERO = "0".charCodeAt(0);
const NINE = "9".charCodeAt(0);

/** Fast check: is the input worth parsing? Returns early with the original
 *  array for any chunk that contains no ESC bytes, which is the common case
 *  for bulk shell output between prompt escapes. */
function hasEsc(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] === ESC) return true;
  return false;
}

function isDigit(b: number): boolean {
  return b >= ZERO && b <= NINE;
}

/** Public entry point. Returns a new Uint8Array with every SGR "black bg"
 *  code rewritten to 49 (reset bg). Shrinks or preserves length — never
 *  grows — so the caller can count on the result being <= input.length.
 *  Returns the ORIGINAL reference when nothing would change (fast path). */
export function stripAnsiBlackBg(input: Uint8Array): Uint8Array {
  if (!hasEsc(input)) return input;

  const n = input.length;
  // Worst case: same length as input (40 → 49 preserves width; 48;5;0 → 49
  // shrinks). We never grow, so a single pre-allocation fits every outcome.
  const out = new Uint8Array(n);
  let oi = 0;
  // Set to true the moment we actually rewrite a black-bg param, so an
  // all-passthrough chunk can return the original reference without copying.
  let didRewrite = false;

  let i = 0;
  while (i < n) {
    const byte = input[i];

    // Non-CSI byte → copy through. Also handles a bare ESC with no `[`.
    if (byte !== ESC || i + 1 >= n || input[i + 1] !== LBRACKET) {
      out[oi++] = byte;
      i++;
      continue;
    }

    // Walk parameter bytes (digits + ';') until the first non-param byte.
    let j = i + 2;
    while (j < n) {
      const c = input[j];
      if (!isDigit(c) && c !== SEMI) break;
      j++;
    }

    // Non-SGR CSI (cursor moves, erases, mode sets, …) is copied verbatim.
    if (j >= n || input[j] !== M) {
      const end = Math.min(j + 1, n);
      for (let k = i; k < end; k++) out[oi++] = input[k];
      i = end;
      continue;
    }

    // SGR sequence. Parse params and rewrite any black-bg selectors.
    const params = parseParams(input, i + 2, j);
    const kept: number[] = [];
    let mutated = false;
    for (let k = 0; k < params.length; k++) {
      const p = params[k];
      if (p === 40 || p === 100) {
        kept.push(49);
        mutated = true;
        continue;
      }
      if (p === 48 && params[k + 1] === 5 && params[k + 2] === 0) {
        kept.push(49);
        mutated = true;
        k += 2;
        continue;
      }
      if (
        p === 48 &&
        params[k + 1] === 2 &&
        params[k + 2] === 0 &&
        params[k + 3] === 0 &&
        params[k + 4] === 0
      ) {
        kept.push(49);
        mutated = true;
        k += 4;
        continue;
      }
      kept.push(p);
    }

    if (!mutated) {
      // No black-bg selector in this SGR — copy the original bytes verbatim.
      for (let k = i; k <= j; k++) out[oi++] = input[k];
      i = j + 1;
      continue;
    }

    // Emit the rewritten SGR. Empty params ("\x1b[m") canonicalise to the
    // same empty-param form, which xterm reads as SGR 0 (reset) — the
    // behaviour callers already expect.
    didRewrite = true;
    out[oi++] = ESC;
    out[oi++] = LBRACKET;
    for (let k = 0; k < kept.length; k++) {
      if (k > 0) out[oi++] = SEMI;
      oi = writeDigits(out, oi, kept[k]);
    }
    out[oi++] = M;

    i = j + 1;
  }

  return didRewrite ? out.subarray(0, oi) : input;
}

function parseParams(buf: Uint8Array, start: number, end: number): number[] {
  // Semicolons separate params. Empty params count as 0 (standard xterm
  // behaviour — "\x1b[;5m" is equivalent to "\x1b[0;5m").
  const params: number[] = [];
  let cur = 0;
  let hasAny = false;
  for (let i = start; i < end; i++) {
    const c = buf[i];
    if (c === SEMI) {
      params.push(cur);
      cur = 0;
      hasAny = true;
      continue;
    }
    // Digit: accumulate. Cap at 10k to match xterm's param limit and
    // avoid overflow-like behaviour on pathological inputs.
    cur = cur * 10 + (c - ZERO);
    if (cur > 65535) cur = 65535;
    hasAny = true;
  }
  if (hasAny) params.push(cur);
  return params;
}

function writeDigits(out: Uint8Array, pos: number, n: number): number {
  if (n === 0) {
    out[pos++] = ZERO;
    return pos;
  }
  // Digits left-to-right — write into a temp buffer and copy, since we
  // need most-significant-first and don't know the length up front.
  const tmp: number[] = [];
  let v = n;
  while (v > 0) {
    tmp.push(ZERO + (v % 10));
    v = Math.floor(v / 10);
  }
  for (let i = tmp.length - 1; i >= 0; i--) out[pos++] = tmp[i];
  return pos;
}

