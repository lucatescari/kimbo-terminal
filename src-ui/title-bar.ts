import { getCurrentWindow } from "@tauri-apps/api/window";
import { icon } from "./icons";
import { getActiveTab, splitActive } from "./tabs";
import { toggleCommandPalette } from "./command-palette";
import { toggleSettings } from "./settings";

let root: HTMLElement;
let titleEl: HTMLElement;

/** Initialize the custom title bar. Must run after DOMContentLoaded. */
export function initTitleBar(container: HTMLElement): void {
  root = container;
  root.innerHTML = "";
  // Tauri 2 cross-platform drag region. With decorations: false there's no
  // native chrome, so the whole bar is ours. Children that should remain
  // clickable (buttons) don't inherit the attribute.
  root.setAttribute("data-tauri-drag-region", "");

  root.appendChild(buildTrafficLights());

  const title = document.createElement("div");
  title.className = "title";
  title.setAttribute("data-tauri-drag-region", "");
  titleEl = title;
  root.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "actions";

  const paletteBtn = makeIconBtn("search", "Command palette (⌘K)", () => {
    toggleCommandPalette();
  });
  actions.appendChild(paletteBtn);

  const splitBtn = makeIconBtn("split", "Split pane (⌘D)", () => {
    splitActive("vertical");
  });
  actions.appendChild(splitBtn);

  const settingsBtn = makeIconBtn("settings", "Settings (⌘,)", () => {
    void toggleSettings();
  });
  actions.appendChild(settingsBtn);

  root.appendChild(actions);

  // Double-click empty area of the bar to toggle maximize (macOS convention).
  root.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".tl-btn, .icon-btn, button")) return;
    void getCurrentWindow().toggleMaximize().catch(() => { /* ignore */ });
  });

  renderTitle();
}

export function renderTitle(): void {
  if (!titleEl) return;
  titleEl.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = "kimbo";
  titleEl.appendChild(b);
  const sep = document.createElement("span");
  sep.textContent = " — ";
  sep.style.opacity = "0.4";
  sep.style.margin = "0 8px";
  titleEl.appendChild(sep);
  const tab = getActiveTab();
  const tail = document.createElement("span");
  tail.textContent = (tab?.titleOverride ?? tab?.name) ?? "";
  titleEl.appendChild(tail);
}

// ---------------------------------------------------------------------------
// Custom traffic lights (macOS-style), styled via CSS .tl classes.
// ---------------------------------------------------------------------------

function buildTrafficLights(): HTMLElement {
  const group = document.createElement("div");
  group.className = "traffic";

  group.appendChild(trafficBtn("close", "Close", async () => {
    await getCurrentWindow().close();
  }));
  group.appendChild(trafficBtn("min", "Minimize", async () => {
    await getCurrentWindow().minimize();
  }));
  group.appendChild(trafficBtn("max", "Zoom", async () => {
    await getCurrentWindow().toggleMaximize();
  }));

  return group;
}

function trafficBtn(
  kind: "close" | "min" | "max",
  title: string,
  onClick: () => Promise<void>,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `tl-btn tl-${kind}`;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void onClick().catch((err) => console.warn(`${kind} failed:`, err));
  });
  // Glyph shown on hover (matches macOS traffic-light behavior).
  const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyph.setAttribute("class", "glyph");
  glyph.setAttribute("viewBox", "0 0 12 12");
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = trafficGlyph(kind);
  b.appendChild(glyph);
  return b;
}

function trafficGlyph(kind: "close" | "min" | "max"): string {
  switch (kind) {
    case "close":
      // Diagonal cross
      return '<line x1="3.5" y1="3.5" x2="8.5" y2="8.5" /><line x1="8.5" y1="3.5" x2="3.5" y2="8.5" />';
    case "min":
      // Horizontal bar
      return '<line x1="3" y1="6" x2="9" y2="6" />';
    case "max":
      // Two triangles (enter full-screen glyph)
      return '<path d="M4.5 4.5 L4.5 7.5 L7.5 4.5 Z" /><path d="M7.5 7.5 L7.5 4.5 L4.5 7.5 Z" />';
  }
}

function makeIconBtn(
  name: Parameters<typeof icon>[0],
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = title;
  btn.type = "button";
  btn.appendChild(icon(name, 13, 1.5));
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}
