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
import { collectOpenPanes, type PaneRef } from "./tabs";
import { ptyIsBusy } from "./pty";
import { showQuitDialog } from "./quit-dialog";

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

  if (!getPrefs().confirmQuit) return await triggerQuit();

  const busy = await findBusyPanes();
  if (busy.length === 0) return await triggerQuit();

  const { confirmed, dontAskAgain } = await showQuitDialog(describeBusy(busy));
  if (dontAskAgain) setPref("confirmQuit", false);
  if (!confirmed) return false;
  return await triggerQuit();
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
 *  something rather than a vague "you have work open". */
function describeBusy(busy: PaneRef[]): string {
  if (busy.length === 1) {
    return `A process is still running in ${busy[0].tabName}. Quit and terminate it?`;
  }
  // Preserve duplicate-tab entries (same tab with multiple busy panes
  // shows up twice) but collapse them for the headline. Showing every
  // tab name would blow out the dialog on a multi-pane split.
  const unique = Array.from(new Set(busy.map((p) => p.tabName)));
  if (unique.length === 1) {
    return `${busy.length} panes are still running in ${unique[0]}. Quit and terminate them?`;
  }
  const head = unique.slice(0, 3).join(", ");
  const more = unique.length > 3 ? ` and ${unique.length - 3} more` : "";
  return `${busy.length} panes across ${unique.length} tabs (${head}${more}) are still running. Quit and terminate them?`;
}

async function triggerQuit(): Promise<boolean> {
  quitting = true;
  try {
    await invoke("quit_app");
  } catch (e) {
    quitting = false;
    console.error("[kimbo.quit] invoke('quit_app') failed:", e);
    return false;
  }
  return true;
}
