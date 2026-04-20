import { getActiveSession } from "./tabs";
import { toggleCommandPalette } from "./command-palette";
import { getCwd } from "./pty";

let root: HTMLElement;
let refreshTimer: number | null = null;

interface State {
  cwd: string;
  pid: number | null;
}

const state: State = { cwd: "~", pid: null };

export function initStatusBar(container: HTMLElement): void {
  root = container;
  render();
  startPolling();
}

/** Called after tab/pane/session changes to rerender immediately. */
export function refreshStatusBar(): void {
  render();
}

function startPolling(): void {
  if (refreshTimer != null) return;
  refreshTimer = window.setInterval(async () => {
    const session = getActiveSession();
    if (!session) return;
    state.pid = session.ptyId ?? null;
    try {
      const cwd = await getCwd(session.ptyId);
      if (cwd) {
        state.cwd = cwd.replace(/^\/Users\/[^/]+/, "~");
        render();
      }
    } catch (_) { /* ignore */ }
  }, 2000);
}

function render(): void {
  if (!root) return;
  root.innerHTML = "";

  const utf = segment("utf-8 · LF · zsh", { muted: true });
  const info = segment(state.pid ? `pid ${state.pid} · ${state.cwd}` : state.cwd, { muted: true });

  const cmdBtn = document.createElement("button");
  cmdBtn.className = "seg";
  cmdBtn.type = "button";
  cmdBtn.title = "Open command palette";
  cmdBtn.addEventListener("click", () => toggleCommandPalette());

  const kbd = document.createElement("span");
  kbd.className = "kbd";
  kbd.textContent = "⌘K";
  const cmdLbl = document.createElement("span");
  cmdLbl.textContent = "commands";
  cmdLbl.style.color = "var(--fg-dim)";
  cmdLbl.style.marginLeft = "4px";
  cmdBtn.appendChild(kbd);
  cmdBtn.appendChild(cmdLbl);

  root.appendChild(utf);
  root.appendChild(sep());
  root.appendChild(spacer());
  root.appendChild(info);
  root.appendChild(sep());
  root.appendChild(cmdBtn);
}

function segment(text: string, opts?: { muted?: boolean; accent?: boolean }): HTMLElement {
  const s = document.createElement("span");
  s.className = "seg";
  if (opts?.muted) s.style.color = "var(--fg-dim)";
  if (opts?.accent) s.style.color = "var(--accent)";
  s.textContent = text;
  return s;
}

function sep(): HTMLElement {
  const s = document.createElement("span");
  s.className = "sep";
  return s;
}

function spacer(): HTMLElement {
  const s = document.createElement("span");
  s.className = "spacer";
  return s;
}
