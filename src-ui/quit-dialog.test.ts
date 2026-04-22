import { describe, it, expect, afterEach } from "vitest";
import { showQuitDialog } from "./quit-dialog";

afterEach(() => {
  // Clean up anything a test left mounted so later tests start fresh.
  document.body.innerHTML = "";
});

describe("showQuitDialog: markup", () => {
  it("renders title, body, don't-ask-again checkbox, Cancel + Quit buttons", () => {
    void showQuitDialog("Are you sure?");
    expect(document.querySelector(".quit-confirm-backdrop")).not.toBeNull();
    expect(document.querySelector(".quit-confirm-title")?.textContent).toBe("Quit Kimbo?");
    expect(document.querySelector(".quit-confirm-body")?.textContent).toBe("Are you sure?");
    expect(document.querySelector("input[type=checkbox]")).not.toBeNull();
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".quit-confirm-actions button"),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Quit"]);
    // Close the dialog so afterEach's DOM reset starts clean.
    buttons[0].click();
  });

  it("sets role=dialog + aria-modal for assistive tech", () => {
    void showQuitDialog("x");
    const panel = document.querySelector(".quit-confirm-panel");
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    document.querySelector<HTMLButtonElement>(".btn.ghost")?.click();
  });
});

describe("showQuitDialog: button resolution", () => {
  it("clicking Cancel resolves { confirmed: false, dontAskAgain: false }", async () => {
    const p = showQuitDialog("body");
    document.querySelector<HTMLButtonElement>(".btn.ghost")!.click();
    await expect(p).resolves.toEqual({ confirmed: false, dontAskAgain: false });
    expect(document.querySelector(".quit-confirm-backdrop")).toBeNull();
  });

  it("clicking Quit resolves { confirmed: true, dontAskAgain: false }", async () => {
    const p = showQuitDialog("body");
    document.querySelector<HTMLButtonElement>(".btn.primary")!.click();
    await expect(p).resolves.toEqual({ confirmed: true, dontAskAgain: false });
  });

  it("the don't-ask-again checkbox state is surfaced in the resolved value", async () => {
    const p = showQuitDialog("body");
    const cb = document.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    cb.checked = true;
    document.querySelector<HTMLButtonElement>(".btn.primary")!.click();
    await expect(p).resolves.toEqual({ confirmed: true, dontAskAgain: true });
  });
});

describe("showQuitDialog: keyboard + outside click", () => {
  it("Escape cancels the dialog (no quit)", async () => {
    const p = showQuitDialog("body");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(p).resolves.toMatchObject({ confirmed: false });
  });

  it("Enter confirms ONLY when focus is inside the dialog", async () => {
    const p = showQuitDialog("body");
    // Enter with no focus inside — simulate a stray xterm keydown. The
    // dialog must not treat that as a Quit or the user loses work by
    // holding Enter while the app asks them to confirm.
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // Nothing should have settled — close with Cancel so the promise
    // resolves for the test harness.
    document.querySelector<HTMLButtonElement>(".btn.ghost")!.click();
    await expect(p).resolves.toMatchObject({ confirmed: false });
  });

  it("clicking the backdrop (outside the panel) cancels", async () => {
    const p = showQuitDialog("body");
    const backdrop = document.querySelector<HTMLElement>(".quit-confirm-backdrop")!;
    // target === backdrop: simulates a click on the dimmed area outside
    // the panel. Clicks inside the panel bubble with target=inside, not
    // === backdrop, so those shouldn't dismiss.
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await expect(p).resolves.toMatchObject({ confirmed: false });
  });
});
