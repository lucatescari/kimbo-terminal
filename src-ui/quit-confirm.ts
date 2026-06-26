// Central arbiter for every "the user is trying to quit Kimbo" signal. All
// three paths — the Cmd+Q keybind, the Kimbo → Quit menu item, and the
// window red-x / Cmd+W-on-window — are routed through `confirmAndQuit()`
// so the Settings → General → "Confirm before quit with active panes"
// toggle has exactly one place to apply.
//
// "Active" here is literal: a pane whose PTY has a foreground child
// process that isn't the shell (vim, `npm run dev`, `claude code`, …).
// The check runs through `pty_is_busy` in rust, which compares
// tcgetpgrp(master_fd) to the shell's PID — a single ioctl per pane. If
// every pane is at an idle prompt we skip the dialog even with the pref
// on, because nagging on an empty session is noise.

import { invoke } from "@tauri-apps/api/core";
import { getPrefs, setPref } from "./ui-prefs";
import { collectOpenPanes, snapshotOpenTabs, type PaneRef } from "./tabs";
import { ptyIsBusy } from "./pty";
import { showQuitDialog, showCloseWindowDialog } from "./quit-dialog";
import { saveSession } from "./session-state";

/** Flag flipped the moment the user confirms (or skips confirmation).
 *  Prevents a double prompt when the CloseRequested event fires in
 *  response to app.exit() itself, and stops concurrent Cmd+Q presses
 *  from stacking dialogs. */
let quitting = false;

/** Public entry point used by every quit path. Returns the boolean the
 *  caller can ignore (`true` → quit underway; `false` → user cancelled).
 *  Always safe to call multiple times — the `quitting` guard collapses
 *  re-entry into a single real exit. */
export async function confirmAndQuit(): Promise<boolean> {
  if (quitting) return true;
  if (!(await confirmDiscardBusyPanes())) return false;
  return await triggerQuit();
}

/** Which affordance is asking to discard busy panes — picks the dialog
 *  copy. "quit" closes the whole app; "close-window" closes only the
 *  current (secondary) window. */
export type DiscardVariant = "quit" | "close-window";

/** The busy-pane check + confirm dialog half of the quit flow, WITHOUT
 *  actually quitting. Returns true when the caller may proceed to destroy
 *  the panes (pref off, nothing busy, or the user confirmed) and false when
 *  the user cancelled. Shared so the secondary-window close path can warn
 *  about a busy `npm run dev` the exact same way the app-quit path does —
 *  instead of silently orphaning it. The `variant` selects the wording so a
 *  window close doesn't wrongly say "Quit Kimbo?". */
export async function confirmDiscardBusyPanes(
  variant: DiscardVariant = "quit",
): Promise<boolean> {
  if (!getPrefs().confirmQuit) return true;

  const busy = await findBusyPanes();
  if (busy.length === 0) return true;

  const body = describeBusy(busy, variant);
  const { confirmed, dontAskAgain } =
    variant === "close-window"
      ? await showCloseWindowDialog(body)
      : await showQuitDialog(body);
  if (dontAskAgain) setPref("confirmQuit", false);
  return confirmed;
}

/** Reset guard — only used by tests. Not exported from the barrel. */
export function __resetQuittingForTests(): void {
  quitting = false;
}

/** Query every open pane in parallel, return the ones whose PTY reports
 *  a foreground child process. Errors per pane are swallowed to `false`
 *  — we'd rather skip a confirmation than wedge the quit flow on a
 *  transiently closed FD. */
async function findBusyPanes(): Promise<PaneRef[]> {
  const panes = collectOpenPanes();
  if (panes.length === 0) return [];
  const busyFlags = await Promise.all(
    panes.map((p) => ptyIsBusy(p.ptyId).catch(() => false)),
  );
  return panes.filter((_, i) => busyFlags[i]);
}

/** Natural-English summary of the busy panes for the dialog body. Keeps
 *  the prompt honest: the user sees which tab/pane is actually running
 *  something rather than a vague "you have work open". The trailing
 *  action phrase matches the affordance ("Quit" vs "Close this window") so
 *  the body agrees with the dialog's title and confirm button. */
function describeBusy(busy: PaneRef[], variant: DiscardVariant): string {
  const one = variant === "close-window"
    ? "Close this window and terminate it?"
    : "Quit and terminate it?";
  const many = variant === "close-window"
    ? "Close this window and terminate them?"
    : "Quit and terminate them?";

  if (busy.length === 1) {
    return `A process is still running in ${busy[0].tabName}. ${one}`;
  }
  // Preserve duplicate-tab entries (same tab with multiple busy panes
  // shows up twice) but collapse them for the headline. Showing every
  // tab name would blow out the dialog on a multi-pane split.
  const unique = Array.from(new Set(busy.map((p) => p.tabName)));
  if (unique.length === 1) {
    return `${busy.length} panes are still running in ${unique[0]}. ${many}`;
  }
  const head = unique.slice(0, 3).join(", ");
  const more = unique.length > 3 ? ` and ${unique.length - 3} more` : "";
  return `${busy.length} panes across ${unique.length} tabs (${head}${more}) are still running. ${many}`;
}

async function triggerQuit(): Promise<boolean> {
  quitting = true;
  // Flush the session NOW, before quit_app calls app.exit(0) — a hard
  // process kill that never runs the webview's beforeunload. The 2s
  // autosave poll alone loses anything changed in the final moments
  // (active tab, tab order, a fresh cd), which restored the wrong layout.
  // PTYs are still alive here, so snapshotOpenTabs' cwd query still works.
  // Never let a snapshot/save failure block the quit.
  try {
    saveSession(await snapshotOpenTabs());
  } catch (e) {
    console.warn("[kimbo.quit] session flush before quit failed:", e);
  }
  try {
    await invoke("quit_app");
  } catch (e) {
    quitting = false;
    console.error("[kimbo.quit] invoke('quit_app') failed:", e);
    return false;
  }
  return true;
}
