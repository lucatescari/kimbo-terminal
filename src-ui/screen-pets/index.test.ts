import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initScreenPets, disposeScreenPets, defaultPet } from "./index";
import { getPrefs, setPref, resetCache } from "../ui-prefs";

function layer() { return document.querySelector("#screen-pets-layer") as HTMLElement | null; }

describe("screen pets integration", () => {
  beforeEach(() => {
    localStorage.clear?.();
    resetCache();
    document.body.innerHTML = "";
    disposeScreenPets();
  });
  afterEach(() => disposeScreenPets());

  it("does not mount when disabled", () => {
    initScreenPets(document.body);
    expect(layer()).toBeNull();
  });

  it("mounts a pointer-transparent layer when enabled and seeds a default pet", () => {
    setPref("screenPetsEnabled", true);
    initScreenPets(document.body);
    expect(layer()).not.toBeNull();
    expect(layer()!.style.pointerEvents).toBe("none");
    // empty roster seeded with exactly one pet
    expect(getPrefs().screenPets.length).toBe(1);
    expect(document.querySelectorAll(".screen-pet").length).toBe(1);
  });

  it("renders one element per roster entry, each pointer-interactive", () => {
    setPref("screenPetsEnabled", true);
    setPref("screenPets", [
      { id: "a", species: "dog", color: "brown", name: "A" },
      { id: "b", species: "cockatiel", color: "gray", name: "B" },
    ]);
    initScreenPets(document.body);
    const pets = document.querySelectorAll<HTMLElement>(".screen-pet");
    expect(pets.length).toBe(2);
    expect(pets[0].style.pointerEvents).toBe("auto");
  });

  it("reacts to live enable/disable", () => {
    initScreenPets(document.body);
    expect(layer()).toBeNull();
    setPref("screenPetsEnabled", true);
    expect(layer()).not.toBeNull();
    setPref("screenPetsEnabled", false);
    expect(layer()).toBeNull();
  });

  it("dispose removes the layer", () => {
    setPref("screenPetsEnabled", true);
    initScreenPets(document.body);
    disposeScreenPets();
    expect(layer()).toBeNull();
  });

  it("defaultPet is a cat", () => {
    expect(defaultPet().species).toBe("cat");
  });
});
