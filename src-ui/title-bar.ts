import { icon } from "./icons";
import { getActiveTab, splitActive } from "./tabs";
import { toggleCommandPalette } from "./command-palette";
import { toggleSettings } from "./settings";

let root: HTMLElement;
let titleEl: HTMLElement;

export function initTitleBar(container: HTMLElement): void {
  root = container;
  root.innerHTML = "";

  const traffic = document.createElement("div");
  traffic.className = "traffic";
  root.appendChild(traffic);

  const title = document.createElement("div");
  title.className = "title";
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
    onClick();
  });
  return btn;
}
