// Theme card — used by Settings → Appearance to render one theme tile.
//
// Pure DOM helper. Owns the two-step uninstall interaction (1st click on the
// × arms a "Delete?" pill, 2nd click within 3s actually deletes; arming
// times out automatically). Keeping this state INSIDE the card means
// tests can drive it without touching settings.ts.

import type { UnifiedTheme } from "./settings-types";
import { icon } from "./icons";
import { hexToRgba } from "./color";

export interface ThemeCardCallbacks {
  /** Activate this theme (clicked while Builtin or Installed). */
  onActivate: (slug: string) => void;
  /** Install + activate this theme (clicked while Available). */
  onInstall: (slug: string) => void;
  /** Uninstall this theme (after the user confirms via the two-step click). */
  onUninstall: (slug: string) => void;
  /** Open the author's GitHub profile. Optional. */
  onAuthorClick?: (username: string) => void;
}

/** ms to keep the "Delete?" pill armed before reverting to the × icon. */
export const UNINSTALL_ARM_MS = 3000;

export function buildThemeCard(
  t: UnifiedTheme,
  opts: { active: boolean },
  cb: ThemeCardCallbacks,
): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "theme-card" + (opts.active ? " selected" : "");
  card.dataset.slug = t.slug;
  card.dataset.source = t.source;

  // Anything drawn ON TOP of the preview — the INSTALL pill, the uninstall ×
  // — has to take its colours from the theme underneath it, not from the
  // app's chrome tokens. Those tokens are dark, so over a light theme's
  // preview they rendered washed-out grey on cream and the INSTALL pill was
  // very nearly invisible (GitHub Light, Gruvbox Light, Rosé Pine Dawn,
  // Solarized Light all showed it).
  //
  // The theme's own foreground contrasts with its own background by
  // definition, which makes it the one safe choice for overlay text on an
  // arbitrary theme. A faint wash of the same colour lifts the pill off the
  // preview without hiding what is behind it.
  card.style.setProperty("--tc-overlay-fg", t.swatches.foreground);
  card.style.setProperty("--tc-overlay-bg", hexToRgba(t.swatches.foreground, 0.14));
  card.style.setProperty("--tc-overlay-border", hexToRgba(t.swatches.foreground, 0.28));

  card.appendChild(buildPreview(t));
  card.appendChild(buildMeta(t, opts.active, cb));

  if (t.source === "Available") {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Install";
    card.appendChild(badge);
  }

  if (t.source === "Installed") {
    card.appendChild(buildUninstall(t, cb));
  }

  card.addEventListener("click", () => {
    if (t.source === "Available") cb.onInstall(t.slug);
    else cb.onActivate(t.slug);
  });

  return card;
}

/** One coloured run of text inside the preview's fake terminal. */
function seg(cls: string, text: string, color: string, faded = false): HTMLElement {
  const el = document.createElement("span");
  el.className = faded ? `${cls} faded` : cls;
  el.textContent = text;
  el.style.color = color;
  return el;
}

/** A mock of a small Kimbo window, painted in the theme's own colours.
 *
 *  This replaced four bars of varying height. Bars showed the palette but
 *  said nothing about the thing people actually judge a terminal theme on —
 *  how a prompt and its output read against the background.
 *
 *  Colour availability differs by source. A Builtin or Installed theme is a
 *  full theme on disk, so ansiGreen/Yellow/BrightBlack are present. An
 *  Available theme is known only from the community index.json, which
 *  carries four colours. Those segments then fold back onto accent and
 *  foreground: the LAYOUT stays identical either way, because a card that
 *  changes shape depending on whether you happen to have installed it
 *  reads as a bug when the grid is full of both. */
function buildPreview(t: UnifiedTheme): HTMLElement {
  const { background, foreground, accent, cursor } = t.swatches;
  const green = t.swatches.green ?? accent;
  const yellow = t.swatches.yellow ?? accent;
  // No theme-supplied dim colour: use the foreground and let CSS drop its
  // opacity. Computing a blend inline would be more faithful, but the value
  // has to survive being read back as a plain colour, and `.faded` also
  // gives tests something unambiguous to assert on.
  const hasDim = t.swatches.dim !== undefined;
  const dim = t.swatches.dim ?? foreground;

  const preview = document.createElement("div");
  preview.className = "preview";
  preview.style.background = background;

  // --- title bar ---
  const chrome = document.createElement("div");
  chrome.className = "chrome";
  const lights = document.createElement("span");
  lights.className = "lights";
  // The traffic lights stay macOS red/amber/green rather than theme colours.
  // They are window chrome, not terminal content, and recolouring them made
  // the mock read as an abstract graphic again.
  for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
    const d = document.createElement("i");
    d.style.background = color;
    lights.appendChild(d);
  }
  chrome.appendChild(lights);
  chrome.appendChild(seg("tab", "~/projects", dim, !hasDim));
  preview.appendChild(chrome);

  // --- terminal content ---
  const term = document.createElement("div");
  term.className = "term";

  const line1 = document.createElement("div");
  line1.className = "line";
  line1.appendChild(seg("path", "~/kimbo", accent));
  line1.appendChild(seg("sigil", "\u276f", green));
  line1.appendChild(seg("cmd", "npm run dev", foreground));
  term.appendChild(line1);

  const line2 = document.createElement("div");
  line2.className = "line";
  line2.appendChild(seg("tick", "\u2713", green));
  line2.appendChild(seg("out", "ready in", dim, !hasDim));
  line2.appendChild(seg("ms", "184 ms", yellow));
  term.appendChild(line2);

  const line3 = document.createElement("div");
  line3.className = "line";
  line3.appendChild(seg("sigil", "\u276f", green));
  const caret = document.createElement("span");
  caret.className = "caret";
  // Static, not blinking: a grid of twenty cards all pulsing is miserable.
  caret.style.background = cursor;
  line3.appendChild(caret);
  term.appendChild(line3);

  preview.appendChild(term);
  return preview;
}

function buildMeta(t: UnifiedTheme, active: boolean, cb: ThemeCardCallbacks): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "meta";

  const name = document.createElement("div");
  name.className = "name";
  const nameText = document.createElement("span");
  nameText.textContent = t.name;
  name.appendChild(nameText);
  if (active) {
    const dot = document.createElement("span");
    dot.className = "dot";
    name.appendChild(dot);
  }
  meta.appendChild(name);

  const author = document.createElement("div");
  author.className = "author";
  if (t.author) {
    const a = document.createElement("a");
    a.textContent = `@${t.author}`;
    a.href = `https://github.com/${t.author}`;
    a.dataset.role = "author-link";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cb.onAuthorClick?.(t.author);
    });
    author.appendChild(a);
  }
  if (t.version) {
    const v = document.createElement("span");
    v.textContent = ` · v${t.version}`;
    author.appendChild(v);
  }
  meta.appendChild(author);
  return meta;
}

function buildUninstall(t: UnifiedTheme, cb: ThemeCardCallbacks): HTMLElement {
  const del = document.createElement("span");
  del.className = "theme-del";
  del.title = `Uninstall "${t.name}"`;
  del.setAttribute("role", "button");
  del.dataset.slug = t.slug;
  del.appendChild(icon("close", 11, 2));

  let armed = false;
  let armTimer: number | null = null;

  const disarm = () => {
    armed = false;
    del.classList.remove("arm");
    del.title = `Uninstall "${t.name}"`;
    del.innerHTML = "";
    del.appendChild(icon("close", 11, 2));
    if (armTimer != null) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  };

  const arm = () => {
    armed = true;
    del.classList.add("arm");
    del.title = `Click again to confirm uninstalling "${t.name}"`;
    del.innerHTML = "";
    const lbl = document.createElement("span");
    lbl.textContent = "Delete?";
    del.appendChild(lbl);
    armTimer = window.setTimeout(disarm, UNINSTALL_ARM_MS);
  };

  del.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!armed) {
      arm();
      return;
    }
    disarm();
    cb.onUninstall(t.slug);
  });

  return del;
}
