// Theme card — used by Settings → Appearance to render one theme tile.
//
// Pure DOM helper. Owns the two-step uninstall interaction (1st click on the
// × arms a "Delete?" pill, 2nd click within 3s actually deletes; arming
// times out automatically). Keeping this state INSIDE the card means
// tests can drive it without touching settings.ts.

import type { UnifiedTheme } from "./settings-types";
import { icon } from "./icons";

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

function buildPreview(t: UnifiedTheme): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "preview";
  preview.style.background = t.swatches.background;

  const tl = document.createElement("div");
  tl.className = "tl";
  for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
    const d = document.createElement("span");
    d.style.background = color;
    tl.appendChild(d);
  }
  preview.appendChild(tl);

  const strip = document.createElement("div");
  strip.className = "strip";
  const heights = ["70%", "100%", "55%", "85%"];
  const colors = [t.swatches.foreground, t.swatches.accent, t.swatches.cursor, t.swatches.foreground];
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("span");
    s.style.background = colors[i];
    s.style.height = heights[i];
    strip.appendChild(s);
  }
  preview.appendChild(strip);
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
