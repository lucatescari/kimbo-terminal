// Minimal right-click context menu for theme cards. No buttons on cards —
// all management actions (Delete especially) live here so the card visual
// stays uniform across Yours and Available groups.
//
// Also exports `showContextMenu` — a lightweight generic menu used by other
// surfaces (e.g. the tab bar) that need a one-off context menu without the
// theme-specific item set.

import type { UnifiedTheme } from "./settings-types";

// ---------------------------------------------------------------------------
// Generic context menu
// ---------------------------------------------------------------------------

export interface SimpleMenuItem {
  label: string;
  onClick: () => void;
}

/** Show a minimal fixed-position context menu with the given items.
 *  Dismisses on outside click, Escape key, or when an item is clicked.
 *  Any previously open generic menu (data-role="kimbo-ctx-menu") is
 *  closed before the new one opens. */
export function showContextMenu(
  items: SimpleMenuItem[],
  x: number,
  y: number,
): void {
  const existing = document.querySelector<HTMLElement>('[data-role="kimbo-ctx-menu"]');
  if (existing) {
    const teardown = (existing as unknown as { _teardown?: () => void })._teardown;
    if (teardown) teardown();
    existing.remove();
  }

  const menu = document.createElement("div");
  menu.dataset.role = "kimbo-ctx-menu";
  menu.style.cssText = [
    "position: fixed",
    `left: ${x}px`,
    `top: ${y}px`,
    "background: var(--surface)",
    "border: 1px solid var(--border)",
    "border-radius: 6px",
    "padding: 4px 0",
    "min-width: 120px",
    "font-size: 13px",
    "color: var(--fg)",
    "box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35)",
    "z-index: 10000",
  ].join("; ");

  let onOutside: ((e: MouseEvent) => void) | null = null;
  let onKey: ((e: KeyboardEvent) => void) | null = null;

  const dismiss = () => {
    menu.remove();
    if (onOutside) document.removeEventListener("mousedown", onOutside);
    if (onKey) document.removeEventListener("keydown", onKey);
  };

  for (const it of items) {
    const row = document.createElement("div");
    row.dataset.role = "menu-item";
    row.textContent = it.label;
    row.style.cssText = [
      "padding: 6px 12px",
      "cursor: pointer",
    ].join("; ");
    row.addEventListener("mouseenter", () => { row.style.background = "var(--border)"; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    row.addEventListener("click", () => { dismiss(); it.onClick(); });
    menu.appendChild(row);
  }

  onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) dismiss();
  };
  onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismiss();
  };

  (menu as unknown as { _teardown?: () => void })._teardown = dismiss;

  document.addEventListener("mousedown", onOutside);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(menu);
}

export interface ContextMenuHandlers {
  onActivate: () => void | Promise<void>;
  onInstall: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onOpenAuthor: () => void | Promise<void>;
}

interface MenuItem {
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void | Promise<void>;
}

export function showThemeContextMenu(
  theme: UnifiedTheme,
  x: number,
  y: number,
  handlers: ContextMenuHandlers,
): void {
  dismissExisting();
  const items = buildItemsForTheme(theme, handlers);
  const menu = renderMenu(items, x, y);
  document.body.appendChild(menu);
  wireDismissal(menu);
}

function buildItemsForTheme(
  theme: UnifiedTheme,
  h: ContextMenuHandlers,
): MenuItem[] {
  const items: MenuItem[] = [];

  if (theme.source === "Available") {
    items.push({ label: "Install", onClick: h.onInstall });
  } else {
    items.push({
      label: "Activate",
      disabled: theme.active,
      onClick: h.onActivate,
    });
  }

  if (theme.source === "Installed") {
    items.push({
      label: "Delete",
      disabled: theme.active,
      title: theme.active ? "Switch to another theme first" : undefined,
      onClick: h.onDelete,
    });
  }

  if (theme.author) {
    items.push({ label: "View author on GitHub", onClick: h.onOpenAuthor });
  }

  return items;
}

function renderMenu(items: MenuItem[], x: number, y: number): HTMLElement {
  const menu = document.createElement("div");
  menu.dataset.role = "theme-ctx-menu";
  menu.style.cssText = [
    "position: fixed",
    `left: ${x}px`,
    `top: ${y}px`,
    "background: var(--surface)",
    "border: 1px solid var(--border)",
    "border-radius: 6px",
    "padding: 4px 0",
    "min-width: 180px",
    "font-size: 13px",
    "color: var(--fg)",
    "box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35)",
    "z-index: 10000",
  ].join("; ");

  for (const it of items) {
    const row = document.createElement("div");
    row.dataset.role = "menu-item";
    row.textContent = it.label;
    row.setAttribute("data-disabled", String(!!it.disabled));
    if (it.title) row.setAttribute("title", it.title);
    row.style.cssText = [
      "padding: 6px 12px",
      `cursor: ${it.disabled ? "default" : "pointer"}`,
      `opacity: ${it.disabled ? "0.45" : "1"}`,
    ].join("; ");
    if (!it.disabled) {
      row.addEventListener("mouseenter", () => {
        row.style.background = "var(--border)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", async () => {
        dismissExisting();
        await it.onClick();
      });
    }
    menu.appendChild(row);
  }
  return menu;
}

function wireDismissal(menu: HTMLElement) {
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) dismissExisting();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismissExisting();
  };
  document.addEventListener("mousedown", onOutside);
  document.addEventListener("keydown", onKey);
  // Stash removers on the node so dismissExisting can clean them up.
  (menu as unknown as { _teardown?: () => void })._teardown = () => {
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
  };
}

function dismissExisting(): void {
  const existing = document.querySelector<HTMLElement>('[data-role="theme-ctx-menu"]');
  if (!existing) return;
  const teardown = (existing as unknown as { _teardown?: () => void })._teardown;
  if (teardown) teardown();
  existing.remove();
}
