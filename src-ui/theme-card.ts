// Pure DOM helper for rendering a single theme card in the unified themes
// settings section. Kept free of module-scope state so it's straightforward
// to unit-test under jsdom.

import type { UnifiedTheme } from "./settings-types";

export interface CardCallbacks {
  onActivate: (slug: string) => void;
  onInstall: (slug: string) => void;
  onOpenAuthor: (username: string) => void;
  onContextMenu: (slug: string, x: number, y: number) => void;
}

export function renderUnifiedThemeCard(t: UnifiedTheme, cb: CardCallbacks): HTMLElement {
  const card = document.createElement("div");
  card.dataset.slug = t.slug;
  card.dataset.source = t.source;
  card.style.cssText = [
    "padding: 12px",
    "border-radius: 6px",
    "cursor: pointer",
    `border: 2px solid ${t.active ? "var(--active-border)" : "var(--border)"}`,
    `background: ${t.swatches.background}`,
    "transition: border-color 0.15s",
    "display: flex",
    "flex-direction: column",
    "gap: 6px",
  ].join("; ");

  const swatches = document.createElement("div");
  swatches.style.cssText = "display: flex; gap: 4px;";
  for (const color of [t.swatches.background, t.swatches.foreground, t.swatches.accent, t.swatches.cursor]) {
    const dot = document.createElement("div");
    dot.style.cssText = `width: 14px; height: 14px; border-radius: 50%; background: ${color}; border: 1px solid ${t.swatches.foreground}30;`;
    swatches.appendChild(dot);
  }
  card.appendChild(swatches);

  const name = document.createElement("div");
  name.textContent = t.name;
  name.style.cssText = `font-size: 13px; font-weight: 500; color: ${t.swatches.foreground};`;
  card.appendChild(name);

  const meta = document.createElement("div");
  meta.style.cssText = `font-size: 11px; color: ${t.swatches.foreground}a0; display: flex; gap: 6px; align-items: center;`;
  const authorLink = t.author
    ? authorLinkElement(t.author, t.swatches.foreground, cb.onOpenAuthor)
    : null;
  if (authorLink) meta.appendChild(authorLink);
  if (t.author && t.version) {
    const sep = document.createElement("span");
    sep.textContent = "·";
    meta.appendChild(sep);
  }
  if (t.version) {
    const ver = document.createElement("span");
    ver.textContent = `v${t.version}`;
    meta.appendChild(ver);
  }
  card.appendChild(meta);

  card.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.role === "author-link") return;
    if (t.source === "Available") {
      cb.onInstall(t.slug);
    } else {
      cb.onActivate(t.slug);
    }
  });
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    cb.onContextMenu(t.slug, e.clientX, e.clientY);
  });

  return card;
}

function authorLinkElement(
  username: string,
  textColor: string,
  onOpen: (u: string) => void,
): HTMLElement {
  const a = document.createElement("a");
  a.textContent = `@${username}`;
  a.href = `https://github.com/${username}`;
  a.dataset.role = "author-link";
  a.style.cssText = `color: ${textColor}a0; text-decoration: none; border-bottom: 1px dotted ${textColor}60;`;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(username);
  });
  return a;
}
