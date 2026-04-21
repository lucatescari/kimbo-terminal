# OSC 1337 Inline Images — Design

**Date:** 2026-04-21
**Status:** Draft, awaiting review
**Scope:** Phase 2 of inline-image support. Phase 1 (parsing + text marker fallback) is already merged.

## Goal

Render iTerm2 OSC 1337 inline images directly in Kimbo terminal panes, so tools like `fastfetch --logo-type iterm`, `imgcat`, and `chafa --format iterm` display real bitmaps instead of a `[inline image: …]` placeholder.

The image must flow with the scrollback buffer — scrolling, resizing, and evicting just like text.

## Non-goals

- Sixel, Kitty graphics protocol, or any non-iTerm protocol (separate future work)
- Animated GIF frame-accurate playback beyond what `<img>` gives us for free
- Right-click / save / drag-out interactions (deferred; see "Future work")
- SVG rendering (rejected for security — see §Security)

## Decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Renderer strategy | Custom DOM overlay (no 3rd-party addon) |
| 2 | Scroll behavior | Image flows with scrollback (marker-backed) |
| 3 | Sizing units supported | Full spec: cells, `Npx`, `N%`, `auto` |
| 4 | Safety caps | 10 MB decoded / image, 50 concurrent, 4096 px max dim, PNG/JPEG/GIF/WebP only |
| 5 | Interactivity | Cmd-click → open in default system viewer; nothing else |

## Architecture

Three modules, each with one job.

### `src-ui/osc1337.ts` — parsing + validation (extend existing)

Pure, synchronous, no DOM dependency. Unit-testable.

Adds to the existing parser:

- `sniffBitmapFormat(bytes: Uint8Array): "png" | "jpeg" | "gif" | "webp" | null` — checks magic bytes
- `decodeBase64Bytes(data: string, maxBytes: number): Uint8Array | null` — returns `null` if oversize or invalid
- `resolveImageLayout(attrs, natural, cell, viewport): { pxWidth, pxHeight, rowsToReserve }` — pure sizing math against caller-supplied measurements

### `src-ui/osc1337-renderer.ts` — layout + lifecycle (new)

Owns all DOM and xterm-marker interaction.

**Exports a single function:**

```ts
export function attachOsc1337Renderer(
  term: Terminal,
  container: HTMLElement,
): () => void; // returns dispose()
```

**Owns internally:**

- `liveImages: Map<IMarker, LiveImage>` — up to 50 entries
- An absolute-positioned overlay `<div>` appended to `container` (sibling of `.xterm-screen`)
- A `ResizeObserver` on `container`
- A measured `{cellWidth, cellHeight}` cache, invalidated on `term.onResize`

**Registers on `term.parser`:** the OSC 1337 handler (replaces the one currently in `terminal.ts`).

**Per-image lifecycle:**

1. Parse + gate checks (size, format, inline flag, concurrency cap)
2. Decode base64 → `Uint8Array`; sniff format
3. Build blob URL → load into a detached `<img>` to get natural dims (await `load`)
4. Compute layout via `resolveImageLayout`
5. Reserve N rows: `term.write("\r\n".repeat(N))`
6. Register marker at the top reserved row: `term.registerMarker(-N)`
7. Position `<img>` over the reserved rows via `style.top` relative to overlay
8. Wire `marker.onDispose` → revoke blob URL, remove `<img>`, drop from map
9. On `term.onScroll` / `term.onResize` / `ResizeObserver` → re-compute `top` for every live image

### `src-ui/terminal.ts` — wiring only

Replace the current inline OSC 1337 handler (lines 150–158) with:

```ts
const disposeImages = attachOsc1337Renderer(term, container);
```

Hook `disposeImages()` into `session.dispose()`.

## Data flow

PTY → xterm parser → our OSC handler → (gates) → (decode) → (layout) → (reserve rows + marker) → (DOM overlay) → (scroll/resize sync until marker disposed).

Every failure path exits to the phase-1 text marker (`[inline image: name, geometry, size, <reason>]`) and returns `true` from the handler so the raw bytes are always consumed and never hit the screen.

## Sizing rules

For each of `width` and `height`:

| Input | Resolution |
|---|---|
| `N` (plain integer) | `N * cellWidth` (or `N * cellHeight` for height) |
| `Npx` | literal pixels |
| `N%` | `N/100 * term.element.clientWidth` (or `clientHeight`) |
| `auto` | image's natural dimension |

**Aspect-ratio logic** (when `preserveAspectRatio=1`, the spec default):

- One dim given, other `auto` → compute missing dim from natural ratio
- Both given → fit-inside (letterbox), never crop or distort
- Neither given → natural size

**Final clamps** (always applied):

- `pxWidth ≤ container.clientWidth`
- `pxHeight ≤ 4096`
- Never scale up beyond natural size

**Row count:** `rowsToReserve = ceil(pxHeight / cellHeight)`.

**Cell measurement:** read `getBoundingClientRect()` of a rendered `.xterm-rows > div` on first use; cache; invalidate on `term.onResize` (font/size changes always trigger a resize event).

## Error handling

All failures fall through to the text marker. The handler never throws.

| Condition | Marker suffix |
|---|---|
| Parse fails (no `File=` or no `:`) | — (phase-1 behavior) |
| `inline !== 1` | `(download-only, not rendered)` |
| Decoded size > 10 MB | `(too large)` |
| Format sniff returns `null` (incl. SVG) | `(unsupported format)` |
| `<img>` `onerror` fires post-sniff | `(decode failed)` |
| Live count ≥ 50 | evict oldest → its overlay replaced with its own marker text |

Blob URLs are revoked in three places: `marker.onDispose`, `<img>` `onerror`, and the renderer's top-level `dispose()`. No leaks.

## Security

- **SVG rejected.** SVG can embed `<script>` and fetch external resources. Only PNG/JPEG/GIF/WebP pass the magic-byte sniff.
- **Hard 10 MB cap** per image, enforced *before* allocating the `Uint8Array`, so a malicious 1 GB payload on the PTY can't OOM the renderer.
- **50 concurrent cap** bounds DOM node count and GPU memory.
- **No external fetches.** Only blob URLs from in-process bytes; `<img>` never loads from the network.
- **Cmd-click opens via `openUrl` (Tauri opener plugin)** — same trusted path as OSC 8 links, which already requires user intent (Cmd held).

## Testing

### Unit tests (`src-ui/osc1337.test.ts`, extended)

- Format sniffing: a fixture byte array for each of PNG / JPEG / GIF / WebP → expected format; SVG header and random bytes → `null`
- `decodeBase64Bytes` with oversized payload → `null`
- `resolveImageLayout` — table-driven against synthetic `(cellW, cellH, viewportW, naturalW, naturalH, attrs)` tuples covering:
  - cells, px, %, auto (each axis independently)
  - aspect preservation with one-dim-given
  - fit-inside when both given
  - viewport-width clamp
  - max-dim clamp (4096)

### Integration tests (`src-ui/osc1337-renderer.test.ts`, new; jsdom)

- Attach renderer to a real `Terminal`; feed OSC 1337 via `term.write()`; assert `<img>` appears in overlay with expected dimensions
- Scroll the terminal (`term.scrollLines`); assert overlay `style.top` changed
- Trigger a `term.onResize`; assert cell cache invalidated and live images re-positioned
- Feed 51 images; assert first one was evicted (its overlay replaced with text marker)
- Dispose the session; assert overlay `<div>` removed, `URL.revokeObjectURL` called for every live blob (spy)
- Malformed base64, oversize payload, SVG payload — each produces a text marker, no `<img>` inserted

### Manual smoke (documented; not automated)

Inside Kimbo:
- `fastfetch --logo-type iterm` → logo renders correctly above the system info
- `imgcat small.png` → image appears inline, scrolls with buffer
- `imgcat huge.jpg` (> 10 MB) → text marker with `(too large)`
- Resize the pane — image scales with viewport
- Scroll the image out of scrollback — no console errors, no leaked blob URLs (check DevTools memory panel)

## File touch list

- `src-ui/osc1337.ts` — add `sniffBitmapFormat`, `decodeBase64Bytes`, `resolveImageLayout`
- `src-ui/osc1337.test.ts` — extend with unit tests for the three new helpers
- `src-ui/osc1337-renderer.ts` — new, owns DOM + marker lifecycle
- `src-ui/osc1337-renderer.test.ts` — new, jsdom integration tests
- `src-ui/terminal.ts` — replace inline OSC 1337 handler (~5 lines) with `attachOsc1337Renderer(term, container)`; wire dispose

No changes to Rust/PTY, Tauri plugins, or CSS beyond possibly one rule for the overlay container (`position: absolute; inset: 0; pointer-events: none` with `pointer-events: auto` on the images themselves — so selection still works over empty overlay regions).

## Future work (out of scope for this spec)

- Right-click context menu (Save As / Copy / Open)
- Drag-out-to-save
- Sixel / Kitty graphics protocol support
- Copy-to-clipboard via OSC 52 integration
- Image lazy-load when scrolling back up (evicted images currently become text-marker-only forever)
