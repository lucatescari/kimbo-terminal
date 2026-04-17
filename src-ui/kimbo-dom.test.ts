import { describe, it, expect, beforeEach } from "vitest";
import { createKimboDom, Corner } from "./kimbo-dom";

describe("kimbo-dom", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("mounts a .kimbo element into the given root", () => {
    const d = createKimboDom(document.body);
    d.mount();
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains("mood-idle")).toBe(true);
    expect(el.classList.contains("corner-bottom_right")).toBe(true);
  });

  it("unmount removes the element", () => {
    const d = createKimboDom(document.body);
    d.mount();
    d.unmount();
    expect(document.querySelector(".kimbo")).toBeNull();
  });

  it("setMood swaps the mood class", () => {
    const d = createKimboDom(document.body);
    d.mount();
    d.setMood("happy");
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("mood-happy")).toBe(true);
    expect(el.classList.contains("mood-idle")).toBe(false);
  });

  it("setCorner swaps the corner class and persists one corner at a time", () => {
    const d = createKimboDom(document.body);
    d.mount();
    d.setCorner("top_left");
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("corner-top_left")).toBe(true);
    expect(el.classList.contains("corner-bottom_right")).toBe(false);
  });

  it("setHidden toggles the hidden class", () => {
    const d = createKimboDom(document.body);
    d.mount();
    d.setHidden(true);
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("hidden")).toBe(true);
    d.setHidden(false);
    expect(el.classList.contains("hidden")).toBe(false);
  });

  it("nearestCorner picks the closest corner based on pointer position", () => {
    const d = createKimboDom(document.body);
    // window default jsdom size is 1024×768
    expect(d.nearestCorner(10, 10)).toBe<Corner>("top_left");
    expect(d.nearestCorner(1000, 10)).toBe<Corner>("top_right");
    expect(d.nearestCorner(10, 700)).toBe<Corner>("bottom_left");
    expect(d.nearestCorner(1000, 700)).toBe<Corner>("bottom_right");
  });

  it("emits click events through the onClick callback", () => {
    const d = createKimboDom(document.body);
    d.mount();
    let clicked = 0;
    d.onClick(() => clicked++);
    const el = document.querySelector(".kimbo") as HTMLElement;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(clicked).toBe(1);
  });

  it("emits contextmenu through the onContextMenu callback", () => {
    const d = createKimboDom(document.body);
    d.mount();
    let seen: { x: number; y: number } | null = null;
    d.onContextMenu((x, y) => { seen = { x, y }; });
    const el = document.querySelector(".kimbo") as HTMLElement;
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 90 }));
    expect(seen).toEqual({ x: 80, y: 90 });
  });

  it("showBubble inserts a transient bubble child", () => {
    const d = createKimboDom(document.body);
    d.mount();
    d.showBubble("nice!");
    const bubble = document.querySelector(".kimbo-bubble");
    expect(bubble?.textContent).toBe("nice!");
  });

  it("showOverlay inserts a transient overlay child and removes it after duration", async () => {
    const d = createKimboDom(document.body);
    d.mount();
    d.showOverlay("heart", 50);
    expect(document.querySelector(".kimbo-overlay.heart")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(document.querySelector(".kimbo-overlay.heart")).toBeNull();
  });

  it("unmount removes window-level mouse listeners (no leak on remount)", () => {
    // Count listener additions by monkey-patching window.addEventListener.
    const added: string[] = [];
    const removed: string[] = [];
    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "mousemove" || type === "mouseup") added.push(type);
      return origAdd(type as keyof WindowEventMap, ...(rest as [EventListener]));
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "mousemove" || type === "mouseup") removed.push(type);
      return origRemove(type as keyof WindowEventMap, ...(rest as [EventListener]));
    }) as typeof window.removeEventListener;

    try {
      const d = createKimboDom(document.body);
      d.mount();
      d.unmount();
      expect(added).toContain("mousemove");
      expect(added).toContain("mouseup");
      expect(removed).toContain("mousemove");
      expect(removed).toContain("mouseup");
    } finally {
      window.addEventListener = origAdd;
      window.removeEventListener = origRemove;
    }
  });
});
