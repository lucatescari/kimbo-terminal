// Welcome popup — first-run keyboard-shortcut intro.
//
// Restyled to match the Kimbo Redesign handoff: modal overlay with app-icon
// header, kbd-chip rows, same palette and form controls used across the new
// design system.

import { invoke } from "@tauri-apps/api/core";

// Keybind list shown in the welcome popup. Kept in sync with README.md.
// Hardcoded by design: first-run users haven't customized keybindings yet.
const KEYBINDS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["⌘", "K"],       label: "Command palette" },
  { keys: ["⌘", "T"],       label: "New tab" },
  { keys: ["⌘", "D"],       label: "Split pane right" },
  { keys: ["⌘", "⇧", "D"],  label: "Split pane down" },
  { keys: ["⌘", "W"],       label: "Close pane" },
  { keys: ["⌘", "O"],       label: "Project launcher" },
  { keys: ["⌘", ","],       label: "Settings" },
  { keys: ["⌘", "Q"],       label: "Quit" },
];

let rootEl: HTMLElement | null = null;
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

export function initWelcome(cfg: { welcome?: { show_on_startup?: boolean } }): void {
  const show = cfg?.welcome?.show_on_startup ?? true;
  if (show) showWelcome();
}

export function isWelcomeVisible(): boolean {
  return rootEl !== null;
}

export function showWelcome(): void {
  if (rootEl) return;
  rootEl = buildPopup();
  (document.getElementById("modal-root") ?? document.body).appendChild(rootEl);

  keydownHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      hideWelcome();
      return;
    }
    if (e.key === "Tab" && rootEl) {
      const ok = rootEl.querySelector<HTMLButtonElement>("[data-welcome-action='ok']");
      const never = rootEl.querySelector<HTMLButtonElement>("[data-welcome-action='never']");
      if (!ok || !never) return;
      e.preventDefault();
      const forward = !e.shiftKey;
      const current = document.activeElement;
      const next = forward
        ? (current === ok ? never : ok)
        : (current === never ? ok : never);
      next.focus();
    }
  };
  document.addEventListener("keydown", keydownHandler);

  const ok = rootEl.querySelector<HTMLButtonElement>("[data-welcome-action='ok']");
  ok?.focus();
}

export function hideWelcome(): void {
  if (!rootEl) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && rootEl.contains(active)) {
    active.blur();
  }
  rootEl.remove();
  rootEl = null;
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
}

async function dismissAndOptOut(): Promise<void> {
  hideWelcome();
  try {
    const current = await invoke<any>("get_config");
    const next = {
      ...current,
      welcome: { ...(current?.welcome ?? {}), show_on_startup: false },
    };
    await invoke("save_config", { config: next });
  } catch (e) {
    console.error("welcome: failed to persist opt-out:", e);
  }
}

function buildPopup(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.dataset.role = "welcome";
  // Tauri drag region on the blurred backdrop — see comment in settings.ts.
  overlay.setAttribute("data-tauri-drag-region", "");
  // Use screenX/screenY (not clientX/clientY) to tell drag from click —
  // during a Tauri native window drag the window follows the pointer, so
  // client coords stay pinned. See the matching comment in settings.ts.
  let downScreenX = 0, downScreenY = 0;
  overlay.addEventListener("mousedown", (e) => {
    downScreenX = e.screenX;
    downScreenY = e.screenY;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target !== overlay) return;
    const dx = Math.abs(e.screenX - downScreenX);
    const dy = Math.abs(e.screenY - downScreenY);
    if (dx > 4 || dy > 4) return;
    hideWelcome();
  });

  const card = document.createElement("div");
  card.className = "welcome";
  card.addEventListener("click", (e) => e.stopPropagation());

  const head = document.createElement("div");
  head.className = "w-head";
  const ic = document.createElement("div");
  ic.className = "w-icon";
  head.appendChild(ic);
  const h2 = document.createElement("h2");
  h2.textContent = "Welcome to Kimbo";
  head.appendChild(h2);
  card.appendChild(head);

  const sub = document.createElement("p");
  sub.className = "w-subtitle";
  sub.innerHTML = `Press <b style="color: var(--fg); font-family: var(--font-mono); padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: 3px; background: var(--bg-elevated);">⌘K</b> any time to open the command runner. A few shortcuts to get you started:`;
  card.appendChild(sub);

  const keys = document.createElement("div");
  keys.className = "w-keys";
  for (const { keys: chord, label } of KEYBINDS) {
    const k = document.createElement("div");
    k.className = "k";
    const chip = document.createElement("div");
    chip.className = "kbd-chip";
    for (const part of chord) {
      const s = document.createElement("span");
      s.textContent = part;
      chip.appendChild(s);
    }
    k.appendChild(chip);
    keys.appendChild(k);

    const v = document.createElement("div");
    v.className = "v";
    v.textContent = label;
    keys.appendChild(v);
  }
  card.appendChild(keys);

  const foot = document.createElement("div");
  foot.className = "w-foot";
  foot.textContent = "You can customize these in Settings → Keybinds.";
  card.appendChild(foot);

  const actions = document.createElement("div");
  actions.className = "w-actions";

  const never = document.createElement("button");
  never.type = "button";
  never.className = "btn ghost";
  never.textContent = "Don't show again";
  never.dataset.welcomeAction = "never";
  never.addEventListener("click", () => void dismissAndOptOut());
  actions.appendChild(never);

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn primary";
  ok.textContent = "Got it";
  ok.dataset.welcomeAction = "ok";
  ok.addEventListener("click", () => hideWelcome());
  actions.appendChild(ok);

  card.appendChild(actions);

  overlay.appendChild(card);
  return overlay;
}
