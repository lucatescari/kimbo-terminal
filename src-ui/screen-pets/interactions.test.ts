import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initScreenPets, disposeScreenPets } from "./index";
import { setPref, resetCache } from "../ui-prefs";

function firstPetEl() { return document.querySelector(".screen-pet") as HTMLElement; }

describe("screen pet interactions", () => {
  beforeEach(() => {
    localStorage.clear?.();
    resetCache();
    document.body.innerHTML = "";
    disposeScreenPets();
    setPref("screenPetsEnabled", true);
    setPref("screenPets", [{ id: "a", species: "dog", color: "brown", name: "A" }]);
    initScreenPets(document.body);
  });
  afterEach(() => disposeScreenPets());

  it("clicking a pet floats a heart", () => {
    const el = firstPetEl();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el.querySelector(".screen-pet-heart")).not.toBeNull();
  });

  it("pointer drag marks the pet grabbing and moves it", () => {
    // jsdom has no PointerEvent constructor; dispatch MouseEvents with the
    // pointer* type names — listeners on "pointerdown" fire regardless, and
    // MouseEvent carries clientX/clientY which the handler reads.
    const el = firstPetEl();
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    expect(el.classList.contains("grabbing")).toBe(true);
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 80 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(el.classList.contains("grabbing")).toBe(false);
  });
});
