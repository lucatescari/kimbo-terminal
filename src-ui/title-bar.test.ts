// @vitest-environment jsdom
//
// Tests for the custom title bar. These catch three classes of bugs:
//
//   1. DOM wiring — the bar has `data-tauri-drag-region` on the right nodes,
//      and the traffic-light buttons exist with the expected classes so CSS
//      can style them and click handlers can dispatch.
//   2. Tauri API wiring — close / minimize / toggleMaximize call through the
//      Tauri window API when the user clicks a traffic light. A missing
//      capability (see capabilities/default.json) would fail silently in
//      production; this test at least catches the wrong function being
//      called.
//   3. Capability permissions — the Rust-side ACL grants the permissions the
//      UI needs. `core:window:default` is READ-ONLY in Tauri 2.10, so
//      `allow-start-dragging` etc. must be listed explicitly. The
//      capability-file test below is what catches the original "drag does
//      nothing" regression.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Mock Tauri APIs before importing the module under test.
// ---------------------------------------------------------------------------

const close = vi.fn().mockResolvedValue(undefined);
const minimize = vi.fn().mockResolvedValue(undefined);
const toggleMaximize = vi.fn().mockResolvedValue(undefined);
const startDragging = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close,
    minimize,
    toggleMaximize,
    startDragging,
  }),
}));

// Stub modules that title-bar.ts imports transitively.
vi.mock("./command-palette", () => ({ toggleCommandPalette: vi.fn() }));
vi.mock("./settings", () => ({ toggleSettings: vi.fn() }));
vi.mock("./tabs", () => ({
  getActiveTab: () => ({ name: "test-tab" }),
  splitActive: vi.fn(),
}));

import { initTitleBar } from "./title-bar";

// ---------------------------------------------------------------------------
// DOM + behavior
// ---------------------------------------------------------------------------

describe("title-bar: DOM structure", () => {
  let container: HTMLElement;

  beforeEach(() => {
    close.mockClear();
    minimize.mockClear();
    toggleMaximize.mockClear();
    startDragging.mockClear();
    container = document.createElement("div");
    container.id = "title-bar";
    document.body.appendChild(container);
    initTitleBar(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("marks the root bar as a Tauri drag region", () => {
    expect(container.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("marks the title text as a drag region too (so dragging by the title works)", () => {
    const title = container.querySelector<HTMLElement>(".title")!;
    expect(title).not.toBeNull();
    expect(title.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("renders three traffic-light buttons in the expected order", () => {
    const btns = container.querySelectorAll<HTMLButtonElement>(".tl-btn");
    expect(btns).toHaveLength(3);
    expect(btns[0].classList.contains("tl-close")).toBe(true);
    expect(btns[1].classList.contains("tl-min")).toBe(true);
    expect(btns[2].classList.contains("tl-max")).toBe(true);
  });

  it("traffic-light buttons do NOT have drag-region attribute (so clicks land)", () => {
    for (const btn of container.querySelectorAll(".tl-btn")) {
      expect(btn.hasAttribute("data-tauri-drag-region")).toBe(false);
    }
  });

  it("renders palette / split / settings icon buttons", () => {
    const icons = container.querySelectorAll(".actions .icon-btn");
    expect(icons).toHaveLength(3);
  });
});

describe("title-bar: traffic-light wiring", () => {
  let container: HTMLElement;

  beforeEach(() => {
    close.mockClear();
    minimize.mockClear();
    toggleMaximize.mockClear();
    startDragging.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    initTitleBar(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("close button calls getCurrentWindow().close()", () => {
    const btn = container.querySelector<HTMLButtonElement>(".tl-close")!;
    btn.click();
    expect(close).toHaveBeenCalledTimes(1);
    expect(minimize).not.toHaveBeenCalled();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("minimize button calls getCurrentWindow().minimize()", () => {
    const btn = container.querySelector<HTMLButtonElement>(".tl-min")!;
    btn.click();
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("maximize button calls getCurrentWindow().toggleMaximize()", () => {
    const btn = container.querySelector<HTMLButtonElement>(".tl-max")!;
    btn.click();
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(minimize).not.toHaveBeenCalled();
  });

  it("double-click on an empty area of the bar toggles maximize", () => {
    const title = container.querySelector<HTMLElement>(".title")!;
    title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("double-click on a button does NOT toggle maximize (the button handles it)", () => {
    const closeBtn = container.querySelector<HTMLButtonElement>(".tl-close")!;
    closeBtn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(toggleMaximize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Capability permissions — the exact check that would've caught the original
// "drag does nothing" bug. core:window:default is READ-ONLY in Tauri 2.10;
// allow-start-dragging / allow-close / allow-minimize / allow-toggle-maximize
// must be listed explicitly in the capability file.
// ---------------------------------------------------------------------------

describe("tauri capability: window commands are granted", () => {
  const cap = JSON.parse(
    readFileSync(resolve(__dirname, "../src-tauri/capabilities/default.json"), "utf-8"),
  ) as { permissions: string[] };

  it("grants allow-start-dragging (required for data-tauri-drag-region)", () => {
    expect(cap.permissions).toContain("core:window:allow-start-dragging");
  });

  it("grants allow-close (required for custom close button)", () => {
    expect(cap.permissions).toContain("core:window:allow-close");
  });

  it("grants allow-minimize (required for custom minimize button)", () => {
    expect(cap.permissions).toContain("core:window:allow-minimize");
  });

  it("grants allow-toggle-maximize (required for custom zoom button)", () => {
    expect(cap.permissions).toContain("core:window:allow-toggle-maximize");
  });
});

describe("tauri window config: chrome is fully custom", () => {
  const conf = JSON.parse(
    readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf-8"),
  ) as { app: { windows: Array<Record<string, unknown>> } };
  const win = conf.app.windows[0];

  it("decorations: false (no native chrome — our title bar is the only one)", () => {
    expect(win.decorations).toBe(false);
  });

  it("transparent: true (so rounded body corners show through)", () => {
    expect(win.transparent).toBe(true);
  });
});
