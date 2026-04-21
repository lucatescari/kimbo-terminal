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

import { getActiveSession, getActiveTab, closeActiveOrTab, closeTab, getTree } from "./tabs";
import { ptyIsBusy } from "./pty";
import { getPrefs, setPref } from "./ui-prefs";
import { showConfirmDialog } from "./quit-dialog";

/** Active-pane close (⌘W in the standard case — closes a split pane or
 *  the whole tab when only one pane remains). Returns the boolean for
 *  tests; real callers can ignore it. */
export async function confirmAndCloseActive(): Promise<boolean> {
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

/** True when closeActiveOrTab() would close the whole tab (because
 *  there's only one leaf in the active tree). Keeps the dialog body
 *  wording honest about scope. */
function closingWholeTab(): boolean {
  const tree = getTree();
  if (!tree) return true;
  return tree.type === "leaf";
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
