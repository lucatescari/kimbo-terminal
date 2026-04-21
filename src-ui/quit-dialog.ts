// Kimbo-styled confirm dialog. Used by both the quit-confirm flow
// (Cmd+Q, menu Quit, window close) AND the close-pane confirm flow
// (Cmd+W, close_pane menu, close_tab menu). Matches the rest of the
// app's chrome (rounded panel, backdrop, theme tokens) and carries a
// "Don't ask again" checkbox the native Tauri dialog doesn't support.
//
// Shape:
//   ┌─────────────────────────────────┐
//   │  <title>                        │
//   │  <body>                         │
//   │  ☐ Don't ask again              │
//   │            [cancel][confirm]    │
//   └─────────────────────────────────┘
//
// Input model: Enter confirms when focus is inside the dialog (guards
// against stray xterm Enter), Escape cancels, click outside cancels.
// Focus starts on Cancel so a reflexive Enter isn't destructive.

export interface ConfirmDialogOptions {
  title: string;
  body: string;
  /** Primary button label — "Quit", "Close", etc. */
  confirmLabel: string;
  /** Secondary button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, the primary button gets the `.danger` style treatment
   *  for destructive actions (quit, close with running work). */
  dangerous?: boolean;
}

export interface ConfirmDialogResult {
  /** True when the user pressed the primary button (or Enter). */
  confirmed: boolean;
  /** True when the "Don't ask again" checkbox is ticked. Caller is
   *  responsible for persisting the pref change — this module keeps
   *  itself decoupled from the prefs store. */
  dontAskAgain: boolean;
}

// Back-compat alias so the older quit-confirm code keeps naming parity.
export type QuitDialogResult = ConfirmDialogResult;

/** Present the confirm dialog and resolve once the user dismisses it.
 *  The promise never rejects; cancellation resolves to
 *  `{confirmed: false, dontAskAgain: <current checkbox state>}`. */
export function showConfirmDialog(opts: ConfirmDialogOptions): Promise<ConfirmDialogResult> {
  return new Promise<ConfirmDialogResult>((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "quit-confirm-backdrop";

    const panel = document.createElement("div");
    panel.className = "quit-confirm-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "quit-confirm-title");
    backdrop.appendChild(panel);

    const title = document.createElement("h2");
    title.id = "quit-confirm-title";
    title.className = "quit-confirm-title";
    title.textContent = opts.title;
    panel.appendChild(title);

    const msg = document.createElement("p");
    msg.className = "quit-confirm-body";
    msg.textContent = opts.body;
    panel.appendChild(msg);

    // "Don't ask again" — a real <label> wrapping the checkbox so clicking
    // the text toggles it. Caller persists the pref on resolve.
    const checkLabel = document.createElement("label");
    checkLabel.className = "quit-confirm-nag";
    const checkBox = document.createElement("input");
    checkBox.type = "checkbox";
    checkBox.id = "quit-confirm-nag";
    checkLabel.htmlFor = "quit-confirm-nag";
    checkLabel.appendChild(checkBox);
    const checkText = document.createElement("span");
    checkText.textContent = "Don't ask again";
    checkLabel.appendChild(checkText);
    panel.appendChild(checkLabel);

    // Button row. Cancel first, primary Quit button second so the
    // destructive action is on the right (macOS convention).
    const btnRow = document.createElement("div");
    btnRow.className = "quit-confirm-actions";
    panel.appendChild(btnRow);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn ghost";
    cancelBtn.textContent = opts.cancelLabel ?? "Cancel";
    btnRow.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    // `.btn.primary` is the standard app-accent style — solid bg, readable
    // contrast. We intentionally don't pile `.danger` on top here: that
    // class just recolours the TEXT red, and on an accent-coloured bg
    // that reads as a broken "red-on-blue" combination rather than a
    // destructive button. The title+body already signal intent.
    confirmBtn.className = "btn primary";
    confirmBtn.textContent = opts.confirmLabel;
    btnRow.appendChild(confirmBtn);

    // One shared settle() so every exit path cleans up the same way.
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve({ confirmed, dontAskAgain: checkBox.checked });
    };

    cancelBtn.addEventListener("click", () => settle(false));
    confirmBtn.addEventListener("click", () => settle(true));
    // Clicking the blurred backdrop (but NOT the panel) is a cancel.
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) settle(false);
    });

    const onKey = (e: KeyboardEvent) => {
      // Capture phase so a stray terminal focus doesn't swallow Escape.
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      } else if (e.key === "Enter") {
        // Only act when a dialog control (or body) owns focus, so Enter
        // inside the global xterm buffer doesn't silently quit.
        if (panel.contains(document.activeElement)) {
          e.preventDefault();
          settle(true);
        }
      }
    };
    document.addEventListener("keydown", onKey, true);

    (document.getElementById("modal-root") ?? document.body).appendChild(backdrop);
    // Focus Cancel by default so a reflexive Enter isn't destructive.
    requestAnimationFrame(() => cancelBtn.focus());
  });
}

/** Back-compat thin wrapper. Used by the quit-confirm flow; equivalent
 *  to calling `showConfirmDialog` with quit-specific labels. */
export function showQuitDialog(body: string): Promise<ConfirmDialogResult> {
  return showConfirmDialog({
    title: "Quit Kimbo?",
    body,
    confirmLabel: "Quit",
    dangerous: true,
  });
}
