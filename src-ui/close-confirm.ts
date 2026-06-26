// Guard Cmd+W / close-pane / close-tab against silently killing a busy
// pane. When `prefs.confirmQuit` is on AND the target pane has a
// foreground child (pty_is_busy), we pop the same Kimbo-styled confirm
// dialog the quit flow uses — with pane-specific wording and a "Don't
// ask again" checkbox wired to the same pref.
//
// Dropping the pane also kills its PTY session, which (via the Drop
// impl in kimbo-terminal) now session-wide SIGHUP/SIGKILLs every
// descendant. So when the user confirms, anything `npm run dev` spawned
// terminates too — no more init-owned orphans hanging on the port.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { getActiveSession, getActiveTab, closeActiveOrTab, closeTab, getTree, getTabCount } from "./tabs";
import { ptyIsBusy } from "./pty";
import { getPrefs, setPref } from "./ui-prefs";
import { showConfirmDialog } from "./quit-dialog";
import { confirmAndQuit, confirmDiscardBusyPanes } from "./quit-confirm";

/** Active-pane close (⌘W in the standard case — closes a split pane or
 *  the whole tab when only one pane remains). Returns the boolean for
 *  tests; real callers can ignore it. */
export async function confirmAndCloseActive(): Promise<boolean> {
  // Last-tab-single-pane case: closeTab() refuses to kill the only tab,
  // so closeActiveOrTab() would silently do nothing and ⌘W would look
  // broken. Route through closeLastTabOrQuit() — on the main window that's
  // the confirm-and-quit flow; on a secondary window it just closes the
  // window (confirmAndQuit handles its own busy-check + dialog).
  if (isLastTabSingleLeaf()) return await closeLastTabOrQuit();

  const session = getActiveSession();
  if (!session) {
    closeActiveOrTab();
    return true;
  }

  if (!getPrefs().confirmQuit) {
    closeActiveOrTab();
    return true;
  }

  const busy = await ptyIsBusy(session.ptyId).catch(() => false);
  if (!busy) {
    closeActiveOrTab();
    return true;
  }

  // The message is intentionally pane-specific — "Quit Kimbo" wording
  // here would confuse the user into thinking the whole app is closing.
  const { confirmed, dontAskAgain } = await showConfirmDialog({
    title: closingWholeTab() ? "Close tab?" : "Close pane?",
    body: closingWholeTab()
      ? "A process is still running in this tab. Close it and terminate the process?"
      : "A process is still running in this pane. Close it and terminate the process?",
    confirmLabel: "Close",
    dangerous: true,
  });
  if (dontAskAgain) setPref("confirmQuit", false);
  if (!confirmed) return false;
  closeActiveOrTab();
  return true;
}

/** Whole-tab close (⌘⇧W). Walks every pane in the active tab and asks
 *  rust if ANY is busy; one busy pane triggers the dialog, listing how
 *  many descendants will be killed. */
export async function confirmAndCloseActiveTab(): Promise<boolean> {
  // Closing the only tab is really a quit (main window) or a window-close
  // (secondary window) — closeTab() bails on the last tab, so without this
  // ⌘⇧W would be a silent no-op on a single-tab window.
  if (getTabCount() <= 1) return await closeLastTabOrQuit();

  const tab = getActiveTab();
  if (!tab) return true;

  if (!getPrefs().confirmQuit) {
    closeTab(tab.id);
    return true;
  }

  const busyCount = await countBusyPanesInActiveTab();
  if (busyCount === 0) {
    closeTab(tab.id);
    return true;
  }

  const { confirmed, dontAskAgain } = await showConfirmDialog({
    title: "Close tab?",
    body:
      busyCount === 1
        ? "A process is still running in this tab. Close it and terminate the process?"
        : `${busyCount} panes in this tab are still running processes. Close the tab and terminate them all?`,
    confirmLabel: "Close",
    dangerous: true,
  });
  if (dontAskAgain) setPref("confirmQuit", false);
  if (!confirmed) return false;
  closeTab(tab.id);
  return true;
}

/** Closing the last tab/pane of a window. On a SECONDARY window this must
 *  close only that window, never quit the whole app — Cmd+Q / closing the
 *  MAIN window keeps the confirm-and-quit behavior. (The secondary window's
 *  PTYs are reaped by kill_all at app exit — see the per-window-PTY TODO in
 *  commands/window.rs.) */
async function closeLastTabOrQuit(): Promise<boolean> {
  if (getCurrentWindow().label !== "main") {
    return await requestCloseCurrentWindow();
  }
  return await confirmAndQuit();
}

/** Close THIS (secondary) window, running the same busy-process check +
 *  confirm dialog the app-quit path uses first — so a window running e.g.
 *  `npm run dev` can't be closed by ⌘W, the red-x, or the OS close button
 *  without a warning (which would orphan the process until app exit). On
 *  cancel the window stays open. Uses destroy() rather than close() so it
 *  doesn't re-trigger the Rust CloseRequested handler (no confirm loop).
 *
 *  Wired to BOTH the last-tab ⌘W/⌘⇧W path (above) and the
 *  `window-close-requested` event the Rust CloseRequested handler emits for
 *  the red-x / OS close (see main.ts + commands/window.rs). Returns true
 *  when the window was closed, false when the user cancelled. */
export async function requestCloseCurrentWindow(): Promise<boolean> {
  if (!(await confirmDiscardBusyPanes())) return false;
  await getCurrentWindow().destroy();
  return true;
}

/** True when closeActiveOrTab() would close the whole tab (because
 *  there's only one leaf in the active tree). Keeps the dialog body
 *  wording honest about scope. */
function closingWholeTab(): boolean {
  const tree = getTree();
  if (!tree) return true;
  return tree.type === "leaf";
}

/** True when ⌘W would try to close the very last tab/pane — at which
 *  point the user actually wants to quit the app, because the tab bar
 *  has nothing left to show. */
function isLastTabSingleLeaf(): boolean {
  if (getTabCount() > 1) return false;
  const tree = getTree();
  return !tree || tree.type === "leaf";
}

/** Collect every pane in the active tab and ask rust if each is busy. */
async function countBusyPanesInActiveTab(): Promise<number> {
  const tree = getTree();
  if (!tree) return 0;
  const ptyIds: number[] = [];
  walkLeafPtyIds(tree, ptyIds);
  if (ptyIds.length === 0) return 0;
  const flags = await Promise.all(
    ptyIds.map((id) => ptyIsBusy(id).catch(() => false)),
  );
  return flags.filter(Boolean).length;
}

function walkLeafPtyIds(node: any, out: number[]): void {
  if (!node) return;
  if (node.type === "leaf") {
    if (node.session?.ptyId !== undefined) out.push(node.session.ptyId);
    return;
  }
  walkLeafPtyIds(node.first, out);
  walkLeafPtyIds(node.second, out);
}
