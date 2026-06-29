import { describe, it, expect, beforeEach } from "vitest";
import { getPrefs, setPref, resetCache } from "./ui-prefs";

describe("ui-prefs screen pets", () => {
  beforeEach(() => {
    localStorage.clear?.();
    resetCache();
  });

  it("defaults pets off with an empty roster", () => {
    const p = getPrefs();
    expect(p.screenPetsEnabled).toBe(false);
    expect(p.screenPets).toEqual([]);
    expect(p.screenPetsSpeed).toBe("normal");
  });

  it("persists a roster", () => {
    setPref("screenPets", [{ id: "x", species: "cat", color: "brown", name: "Mochi" }]);
    expect(getPrefs().screenPets[0].name).toBe("Mochi");
  });
});
