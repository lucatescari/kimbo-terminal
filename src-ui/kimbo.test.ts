import { describe, it, expect, beforeEach, vi } from "vitest";
import { kimboBus, resetBusForTests } from "./kimbo-bus";
import { initKimbo, hideKimbo, showKimbo, setKimboEnabled, setKimboInConsoleView, disposeKimbo } from "./kimbo";

describe("kimbo integration", () => {
  beforeEach(() => {
    disposeKimbo();
    document.body.innerHTML = "";
    resetBusForTests();
    vi.useFakeTimers();
  });

  it("initKimbo mounts when enabled=true", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    expect(document.querySelector(".kimbo")).not.toBeNull();
  });

  it("initKimbo does not mount when enabled=false", () => {
    initKimbo(document.body, { enabled: false, corner: "bottom_right", idleMs: 60_000 });
    expect(document.querySelector(".kimbo")).toBeNull();
  });

  it("command-end exit=0 triggers happy mood class", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "command-end", exit: 0 });
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("mood-happy")).toBe(true);
  });

  it("command-end exit!=0 triggers sad mood class", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "command-end", exit: 1 });
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("mood-sad")).toBe(true);
  });

  it("hideKimbo / showKimbo toggle the hidden class", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    hideKimbo();
    expect((document.querySelector(".kimbo") as HTMLElement).classList.contains("hidden")).toBe(true);
    showKimbo();
    expect((document.querySelector(".kimbo") as HTMLElement).classList.contains("hidden")).toBe(false);
  });

  it("setKimboEnabled(false) after init unmounts", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    setKimboEnabled(false);
    expect(document.querySelector(".kimbo")).toBeNull();
  });

  it("setKimboInConsoleView(false) hides Kimbo; (true) restores him", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    setKimboInConsoleView(false);
    expect((document.querySelector(".kimbo") as HTMLElement).classList.contains("hidden")).toBe(true);
    setKimboInConsoleView(true);
    expect((document.querySelector(".kimbo") as HTMLElement).classList.contains("hidden")).toBe(false);
  });

  it("session-hide remains in effect after leaving + re-entering console view", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    hideKimbo();
    setKimboInConsoleView(false);
    setKimboInConsoleView(true);
    // sessionHidden should still keep it hidden.
    expect((document.querySelector(".kimbo") as HTMLElement).classList.contains("hidden")).toBe(true);
  });

  it("overlay and bubble never coexist on a single mood firing", () => {
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.1);
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "kimbo-click" }); // love (no milestone at click #1)
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.querySelectorAll(".kimbo-bubble").length).toBe(1);
    expect(el.querySelectorAll(".kimbo-overlay").length).toBe(0);
    rnd.mockRestore();
  });

  it("shows overlay when bubble coin-flip loses", () => {
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.99);
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "kimbo-click" });
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.querySelectorAll(".kimbo-bubble").length).toBe(0);
    expect(el.querySelectorAll(".kimbo-overlay").length).toBe(1);
    rnd.mockRestore();
  });

  it("moods without a bubble entry still show their overlay", () => {
    // sleepy has no BUBBLES entry but has the zzz overlay.
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    vi.advanceTimersByTime(61_000);
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("mood-sleepy")).toBe(true);
    expect(el.querySelectorAll(".kimbo-bubble").length).toBe(0);
    expect(el.querySelectorAll(".kimbo-overlay").length).toBe(1);
  });

  it("first command-end fires the 'let's go!' milestone bubble", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "command-end", exit: 0 });
    const el = document.querySelector(".kimbo") as HTMLElement;
    const bubble = el.querySelector(".kimbo-bubble");
    expect(bubble?.textContent).toBe("let's go!");
    expect(el.querySelectorAll(".kimbo-overlay").length).toBe(0);
  });

  it("fourth new surface fires 'impressive!' and excited mood", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "tab-created" });
    kimboBus.emit({ type: "pane-split" });
    kimboBus.emit({ type: "tab-created" });
    kimboBus.emit({ type: "project-opened" });
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.querySelector(".kimbo-bubble")?.textContent).toBe("impressive!");
    expect(el.classList.contains("mood-excited")).toBe(true);
  });

  it("three consecutive failures override happy with sad + 'you got this!'", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    kimboBus.emit({ type: "command-end", exit: 1 });
    kimboBus.emit({ type: "command-end", exit: 1 });
    kimboBus.emit({ type: "command-end", exit: 1 });
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.querySelector(".kimbo-bubble")?.textContent).toBe("you got this!");
    expect(el.classList.contains("mood-sad")).toBe(true);
  });

  it("welcome-back fires happy when user types while sleepy", () => {
    initKimbo(document.body, { enabled: true, corner: "bottom_right", idleMs: 60_000 });
    // Drive into sleepy.
    vi.advanceTimersByTime(61_000);
    const el = document.querySelector(".kimbo") as HTMLElement;
    expect(el.classList.contains("mood-sleepy")).toBe(true);
    kimboBus.emit({ type: "user-typed" });
    expect(el.querySelector(".kimbo-bubble")?.textContent).toBe("welcome back!");
    expect(el.classList.contains("mood-happy")).toBe(true);
  });
});
