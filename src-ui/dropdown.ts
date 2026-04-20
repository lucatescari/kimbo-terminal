// Custom dropdown component — styled to match the Kimbo design system.
//
// Why not native <select>? Two reasons:
//   1. Native select rendering is OS-dependent and doesn't respect the app's
//      theme tokens (different on macOS, Windows, Linux).
//   2. The old segmented control kept selected state in DOM classes that got
//      stale when the parent didn't re-render, so visually the wrong option
//      looked selected.
//
// The dropdown below is self-contained: it re-renders its own trigger label
// and menu on every change, so "what's selected" is always in sync with the
// last-chosen value.

import { icon } from "./icons";

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional right-aligned secondary text (e.g. shortcut, hint). */
  hint?: string;
}

export interface DropdownConfig {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  /** Minimum menu width. Defaults to 160px. */
  menuMinWidth?: number;
  /** Optional placeholder when value doesn't match any option. */
  placeholder?: string;
}

/** Build a dropdown trigger. Returns the element to insert. The trigger
 *  re-renders its own label when a new value is selected, so callers don't
 *  need to rebuild the whole panel. */
export function buildDropdown(cfg: DropdownConfig): HTMLElement {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dd-trigger";

  let current = cfg.value;

  const labelEl = document.createElement("span");
  labelEl.className = "dd-label";
  trigger.appendChild(labelEl);

  const chev = document.createElement("span");
  chev.className = "dd-chev";
  chev.appendChild(icon("chevron-d", 12, 2));
  trigger.appendChild(chev);

  const syncLabel = () => {
    const hit = cfg.options.find((o) => o.value === current);
    labelEl.textContent = hit?.label ?? cfg.placeholder ?? current ?? "";
  };
  syncLabel();

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu(trigger, cfg, current, (v) => {
      current = v;
      syncLabel();
      cfg.onChange(v);
    });
  });

  return trigger;
}

// ---------- Menu rendering ----------

let openPanel: HTMLElement | null = null;

function closeMenu(): void {
  if (!openPanel) return;
  openPanel.remove();
  openPanel = null;
  window.removeEventListener("click", handleOutsideClick, true);
  window.removeEventListener("keydown", handleKey, true);
  window.removeEventListener("resize", closeMenu);
  window.removeEventListener("scroll", handleOutsideScroll, true);
}

/** Close only when the scroll happens *outside* the panel. Without this
 *  check, scrolling inside the dropdown — either with the wheel or by
 *  dragging its scrollbar — closes the dropdown mid-interaction, which is
 *  obviously wrong when the menu is the thing being scrolled. We still
 *  want to close on scroll of the settings pane underneath so a fixed
 *  menu doesn't hover over content that moved. */
function handleOutsideScroll(e: Event): void {
  if (!openPanel) return;
  const target = e.target as Node | null;
  if (target && openPanel.contains(target)) return;
  closeMenu();
}

function handleOutsideClick(e: MouseEvent): void {
  if (!openPanel) return;
  if (openPanel.contains(e.target as Node)) return;
  closeMenu();
}

function handleKey(e: KeyboardEvent): void {
  if (!openPanel) return;
  const rows = Array.from(openPanel.querySelectorAll<HTMLElement>(".dd-row"));
  const activeIdx = rows.findIndex((r) => r.classList.contains("active"));
  if (e.key === "Escape") {
    e.preventDefault();
    closeMenu();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = Math.min(activeIdx + 1, rows.length - 1);
    setActiveRow(rows, Math.max(0, next));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = activeIdx <= 0 ? 0 : activeIdx - 1;
    setActiveRow(rows, prev);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const cur = rows[activeIdx] ?? rows[0];
    cur?.click();
  }
}

function setActiveRow(rows: HTMLElement[], idx: number): void {
  rows.forEach((r, i) => r.classList.toggle("active", i === idx));
  // scrollIntoView is absent in jsdom and may throw — guard it so tests and
  // any non-standard browsers don't blow up navigating the menu.
  try { rows[idx]?.scrollIntoView?.({ block: "nearest" }); } catch (_) { /* ignore */ }
}

function openMenu(
  trigger: HTMLElement,
  cfg: DropdownConfig,
  current: string,
  onPick: (v: string) => void,
): void {
  closeMenu();

  const panel = document.createElement("div");
  panel.className = "dd-menu";
  panel.style.minWidth = `${cfg.menuMinWidth ?? Math.max(160, trigger.offsetWidth)}px`;

  for (const opt of cfg.options) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dd-row" + (opt.value === current ? " selected" : "");
    row.dataset.value = opt.value;

    const lbl = document.createElement("span");
    lbl.className = "dd-row-label";
    lbl.textContent = opt.label;
    row.appendChild(lbl);

    if (opt.hint) {
      const h = document.createElement("span");
      h.className = "dd-row-hint";
      h.textContent = opt.hint;
      row.appendChild(h);
    }

    const check = document.createElement("span");
    check.className = "dd-row-check";
    if (opt.value === current) check.appendChild(icon("check", 12, 2.5));
    row.appendChild(check);

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(opt.value);
      closeMenu();
    });
    row.addEventListener("mouseenter", () => {
      const rows = Array.from(panel.querySelectorAll<HTMLElement>(".dd-row"));
      rows.forEach((r) => r.classList.remove("active"));
      row.classList.add("active");
    });

    panel.appendChild(row);
  }

  // Pre-select the currently selected row for keyboard nav.
  const rows = Array.from(panel.querySelectorAll<HTMLElement>(".dd-row"));
  const selectedIdx = cfg.options.findIndex((o) => o.value === current);
  if (selectedIdx >= 0) rows[selectedIdx]?.classList.add("active");

  document.body.appendChild(panel);
  positionPanel(panel, trigger);

  openPanel = panel;
  // Capture-phase so outside clicks beat children's stopPropagation.
  window.addEventListener("click", handleOutsideClick, true);
  window.addEventListener("keydown", handleKey, true);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", handleOutsideScroll, true);
}

function positionPanel(panel: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const panelHeight = panel.offsetHeight;
  const vh = window.innerHeight;
  const margin = 4;

  // Prefer below; flip above when the menu would overflow the viewport.
  const spaceBelow = vh - rect.bottom;
  const openUp = spaceBelow < panelHeight + margin + 8 && rect.top > panelHeight + margin + 8;

  const top = openUp ? rect.top - panelHeight - margin : rect.bottom + margin;
  const left = rect.left;

  panel.style.position = "fixed";
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  panel.style.transformOrigin = openUp ? "bottom left" : "top left";
}
