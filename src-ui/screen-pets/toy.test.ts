import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initScreenPets, disposeScreenPets } from "./index";
import { setPref, resetCache } from "../ui-prefs";

describe("screen pets toy button", () => {
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

  it("shows a toy button that throws a ball", () => {
    const toy = document.querySelector(".screen-pet-toy") as HTMLElement;
    expect(toy).not.toBeNull();
    expect(document.querySelector(".screen-pet-ball")).toBeNull();
    toy.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // throwPetBall() creates the ball entity AND calls render() synchronously,
    // so the ball element exists immediately.
    expect(document.querySelector(".screen-pet-ball")).not.toBeNull();
  });
});
