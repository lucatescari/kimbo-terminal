// Lightweight, app-global toast component.
//
// Usage:
//   import { showToast } from "./toast";
//   showToast({ message: "Copied", detail: "claude --resume …" });
//
// Mounts a single host element to <body> on first call; subsequent calls
// just append toast nodes. Toasts slide up from the bottom, hold for
// `durationMs`, then slide back down. Click any toast to dismiss it
// early. Stacks newest-on-top so the most recent message is closest to
// the viewport edge.

export type ToastKind = "success" | "info" | "error";

export interface ToastOptions {
  /** Primary message (required). UI font, ~13px. */
  message: string;
  /** Visual + semantic kind. Default "info". */
  kind?: ToastKind;
  /** How long the toast stays before auto-dismissing. Default 2500ms. */
  durationMs?: number;
  /** Optional secondary line shown smaller below the message. Mono font;
   *  word-breaks so long values like UUIDs / shell commands fit. */
  detail?: string;
}

const ICONS: Record<ToastKind, string> = {
  success: "\u2713", // ✓
  info: "\u24D8",    // ⓘ
  error: "\u26A0",   // ⚠
};

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.id = "toast-host";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

/** Show a toast. Auto-dismisses after `durationMs` (default 2500ms);
 *  also dismissible by click. Multiple calls stack. */
export function showToast(opts: ToastOptions): void {
  const root = ensureHost();
  const kind = opts.kind ?? "info";
  const duration = opts.durationMs ?? 2500;

  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;

  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.textContent = ICONS[kind];
  toast.appendChild(icon);

  const body = document.createElement("div");
  body.className = "toast__body";

  const message = document.createElement("div");
  message.className = "toast__message";
  message.textContent = opts.message;
  body.appendChild(message);

  if (opts.detail) {
    const detail = document.createElement("div");
    detail.className = "toast__detail";
    detail.textContent = opts.detail;
    body.appendChild(detail);
  }

  toast.appendChild(body);
  root.appendChild(toast);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.add("toast--leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    // Defensive: if animationend doesn't fire (animations disabled,
    // user-prefers-reduced-motion), still clean up after a beat.
    setTimeout(() => toast.remove(), 400);
  };

  toast.addEventListener("click", dismiss);
  setTimeout(dismiss, duration);
}

/** Test-only — drop the host element and reset module state between
 *  tests so each test starts with a clean slate. */
export function clearToastsForTesting(): void {
  if (host) host.remove();
  host = null;
}
