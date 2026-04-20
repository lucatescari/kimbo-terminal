import { invoke } from "@tauri-apps/api/core";

// Keybind list shown in the welcome popup. Kept in sync with README.md.
// Hardcoded by design: first-run users haven't customized keybindings yet.
const KEYBINDS: ReadonlyArray<readonly [string, string]> = [
  ["⌘T", "New tab"],
  ["⌘D", "Split vertical"],
  ["⌘⇧D", "Split horizontal"],
  ["⌘W", "Close pane"],
  ["⌘↑ ↓ ← →", "Navigate panes"],
  ["⌘O", "Project launcher"],
  ["⌘,", "Settings"],
  ["⌘Q", "Quit"],
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
  document.body.appendChild(rootEl);

  keydownHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      hideWelcome();
    }
  };
  document.addEventListener("keydown", keydownHandler);

  const ok = rootEl.querySelector<HTMLButtonElement>("[data-welcome-action='ok']");
  ok?.focus();
}

export function hideWelcome(): void {
  if (!rootEl) return;
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
  const root = document.createElement("div");
  root.className = "welcome-popup-root";
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "200",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });

  root.addEventListener("click", (e) => {
    if (e.target === root) hideWelcome();
  });

  const card = document.createElement("div");
  card.className = "welcome-popup-card";
  Object.assign(card.style, {
    width: "480px",
    maxWidth: "90vw",
    background: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  });

  const title = document.createElement("div");
  title.textContent = "Welcome to Kimbo";
  Object.assign(title.style, { fontSize: "18px", fontWeight: "600" });
  card.appendChild(title);

  const intro = document.createElement("div");
  intro.textContent = "A few shortcuts to get you started:";
  Object.assign(intro.style, { fontSize: "13px", color: "var(--tab-inactive-fg)" });
  card.appendChild(intro);

  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: "16px",
    rowGap: "6px",
    fontSize: "13px",
  });
  for (const [chord, label] of KEYBINDS) {
    const k = document.createElement("div");
    k.textContent = chord;
    Object.assign(k.style, {
      fontFamily: "var(--font-family, monospace)",
      color: "var(--fg)",
      whiteSpace: "nowrap",
    });
    const v = document.createElement("div");
    v.textContent = label;
    Object.assign(v.style, { color: "var(--fg)" });
    grid.appendChild(k);
    grid.appendChild(v);
  }
  card.appendChild(grid);

  const footer = document.createElement("div");
  footer.textContent = "You can customize these in Settings > Keybindings.";
  Object.assign(footer.style, { fontSize: "12px", color: "var(--tab-inactive-fg)" });
  card.appendChild(footer);

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "8px",
  });

  const neverBtn = document.createElement("button");
  neverBtn.textContent = "OK, don't show again";
  neverBtn.dataset.welcomeAction = "never";
  Object.assign(neverBtn.style, {
    padding: "6px 12px",
    background: "none",
    border: "1px solid var(--border)",
    color: "var(--fg)",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
  });
  neverBtn.addEventListener("click", () => {
    void dismissAndOptOut();
  });

  const okBtn = document.createElement("button");
  okBtn.textContent = "OK";
  okBtn.dataset.welcomeAction = "ok";
  Object.assign(okBtn.style, {
    padding: "6px 16px",
    background: "var(--accent-blue)",
    border: "1px solid var(--accent-blue)",
    color: "var(--bg)",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "500",
  });
  okBtn.addEventListener("click", () => {
    hideWelcome();
  });

  btnRow.appendChild(neverBtn);
  btnRow.appendChild(okBtn);
  card.appendChild(btnRow);

  root.appendChild(card);
  return root;
}
