// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const welcomeSource = readFileSync(resolve(__dirname, "welcome-popup.ts"), "utf-8");

describe("welcome-popup: module exports", () => {
  it("exports initWelcome", () => {
    expect(welcomeSource).toContain("export function initWelcome");
  });

  it("exports showWelcome", () => {
    expect(welcomeSource).toContain("export function showWelcome");
  });

  it("exports hideWelcome", () => {
    expect(welcomeSource).toContain("export function hideWelcome");
  });

  it("exports isWelcomeVisible", () => {
    expect(welcomeSource).toContain("export function isWelcomeVisible");
  });
});

describe("welcome-popup: keybind content", () => {
  const expectedLabels = [
    "Command palette",
    "New tab",
    "Split pane right",
    "Split pane down",
    "Close pane",
    "Project launcher",
    "Settings",
    "Quit",
  ];

  for (const label of expectedLabels) {
    it(`source lists "${label}"`, () => {
      expect(welcomeSource).toContain(label);
    });
  }

  it("footer points to Settings → Keybinds", () => {
    expect(welcomeSource).toContain("Settings → Keybinds");
  });
});

// --- Behavior tests with mocked invoke ---
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  initWelcome,
  showWelcome,
  hideWelcome,
  isWelcomeVisible,
} from "./welcome-popup";

function cleanupDom() {
  document.body.innerHTML = "";
  hideWelcome();
}

describe("welcome-popup: showWelcome / hideWelcome", () => {
  beforeEach(() => {
    cleanupDom();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("showWelcome appends a popup to the document body", () => {
    expect(isWelcomeVisible()).toBe(false);
    showWelcome();
    expect(isWelcomeVisible()).toBe(true);
    expect(document.querySelectorAll(".modal-overlay[data-role=\"welcome\"]").length).toBe(1);
  });

  it("showWelcome twice does not duplicate the popup", () => {
    showWelcome();
    showWelcome();
    expect(document.querySelectorAll(".modal-overlay[data-role=\"welcome\"]").length).toBe(1);
  });

  it("hideWelcome removes the popup from the DOM", () => {
    showWelcome();
    hideWelcome();
    expect(isWelcomeVisible()).toBe(false);
    expect(document.querySelectorAll(".modal-overlay[data-role=\"welcome\"]").length).toBe(0);
  });
});

describe("welcome-popup: dismiss actions", () => {
  beforeEach(() => {
    cleanupDom();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("clicking OK hides the popup without calling save_config", () => {
    showWelcome();
    const okBtn = document.querySelector<HTMLButtonElement>("[data-welcome-action='ok']");
    expect(okBtn).not.toBeNull();
    okBtn!.click();
    expect(isWelcomeVisible()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clicking 'never show again' hides the popup and saves show_on_startup=false", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") {
        return {
          welcome: { show_on_startup: true },
        } as any;
      }
      return undefined;
    });

    showWelcome();
    const neverBtn = document.querySelector<HTMLButtonElement>("[data-welcome-action='never']");
    expect(neverBtn).not.toBeNull();
    neverBtn!.click();

    await new Promise((r) => setTimeout(r, 0));

    expect(isWelcomeVisible()).toBe(false);
    expect(invoke).toHaveBeenCalledWith("get_config");
    const saveCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === "save_config");
    expect(saveCall).toBeDefined();
    const savedConfig = (saveCall![1] as any).config;
    expect(savedConfig.welcome.show_on_startup).toBe(false);
  });

  it("Escape key dismisses like OK (no save)", () => {
    showWelcome();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isWelcomeVisible()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Enter key dismisses like OK (no save)", () => {
    showWelcome();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(isWelcomeVisible()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clicking the backdrop dismisses like OK (no save)", () => {
    showWelcome();
    const backdrop = document.querySelector<HTMLElement>(".modal-overlay[data-role=\"welcome\"]");
    expect(backdrop).not.toBeNull();
    backdrop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isWelcomeVisible()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clicking inside the card does NOT dismiss", () => {
    showWelcome();
    const card = document.querySelector<HTMLElement>(".welcome");
    expect(card).not.toBeNull();
    card!.click();
    expect(isWelcomeVisible()).toBe(true);
  });
});

describe("welcome-popup: initWelcome", () => {
  beforeEach(() => {
    cleanupDom();
    vi.mocked(invoke).mockReset();
  });

  it("shows the popup when cfg.welcome.show_on_startup is true", () => {
    initWelcome({ welcome: { show_on_startup: true } } as any);
    expect(isWelcomeVisible()).toBe(true);
  });

  it("does nothing when cfg.welcome.show_on_startup is false", () => {
    initWelcome({ welcome: { show_on_startup: false } } as any);
    expect(isWelcomeVisible()).toBe(false);
  });

  it("defaults to showing when cfg.welcome is missing", () => {
    initWelcome({} as any);
    expect(isWelcomeVisible()).toBe(true);
  });
});

describe("welcome-popup: focus management", () => {
  beforeEach(() => {
    cleanupDom();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("Tab cycles forward from OK to 'never show again'", () => {
    showWelcome();
    const ok = document.querySelector<HTMLButtonElement>("[data-welcome-action='ok']")!;
    const never = document.querySelector<HTMLButtonElement>("[data-welcome-action='never']")!;
    ok.focus();
    expect(document.activeElement).toBe(ok);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(never);
  });

  it("Tab cycles forward from 'never show again' back to OK", () => {
    showWelcome();
    const ok = document.querySelector<HTMLButtonElement>("[data-welcome-action='ok']")!;
    const never = document.querySelector<HTMLButtonElement>("[data-welcome-action='never']")!;
    never.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(ok);
  });

  it("Shift+Tab cycles backward from OK to 'never show again'", () => {
    showWelcome();
    const ok = document.querySelector<HTMLButtonElement>("[data-welcome-action='ok']")!;
    const never = document.querySelector<HTMLButtonElement>("[data-welcome-action='never']")!;
    ok.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(never);
  });

  it("hideWelcome removes focus from the popup (returns to body)", () => {
    showWelcome();
    const ok = document.querySelector<HTMLButtonElement>("[data-welcome-action='ok']")!;
    ok.focus();
    expect(document.activeElement).toBe(ok);

    hideWelcome();
    // After dismiss, focus must not be stuck on a detached element.
    expect(document.activeElement).toBe(document.body);
  });
});
