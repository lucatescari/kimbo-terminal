// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderScreenPets } from "./settings";
import { getPrefs, setPref, resetCache } from "./ui-prefs";

describe("screen pets settings", () => {
  beforeEach(() => { resetCache(); localStorage.clear?.(); document.body.innerHTML = ""; });

  it("renders the enable toggle and reflects the roster", () => {
    setPref("screenPetsEnabled", true);
    setPref("screenPets", [{ id: "a", species: "dog", color: "brown", name: "Rex" }]);
    const el = document.createElement("div");
    renderScreenPets(el);
    expect(el.querySelector("input,button,select")).not.toBeNull();
    expect(el.textContent).toContain("Rex");
  });

  it("Add pet appends to the roster", () => {
    setPref("screenPetsEnabled", true);
    setPref("screenPets", []);
    const el = document.createElement("div");
    renderScreenPets(el);
    const add = Array.from(el.querySelectorAll("button")).find((b) => /add pet/i.test(b.textContent || ""))!;
    add.click();
    expect(getPrefs().screenPets.length).toBe(1);
  });
});
