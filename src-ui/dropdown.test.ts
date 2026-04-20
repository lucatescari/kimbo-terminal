// @vitest-environment jsdom
//
// Tests for the custom dropdown component. The previous segmented-control
// implementation kept selected state in DOM classes set at render time, so
// when the user clicked a new option the selected class didn't update
// (because the parent panel didn't re-render). This dropdown manages its
// own label + selected-row state, so these tests verify that contract.

import { describe, it, expect, beforeEach } from "vitest";
import { buildDropdown } from "./dropdown";

function mountTrigger(
  value: string,
  options: Array<[string, string]>,
  onChange: (v: string) => void = () => {},
): HTMLElement {
  document.body.innerHTML = "";
  const trigger = buildDropdown({
    value,
    options: options.map(([v, l]) => ({ value: v, label: l })),
    onChange,
  });
  document.body.appendChild(trigger);
  return trigger;
}

beforeEach(() => {
  // Close any menu leaked from a prior test.
  document.querySelectorAll(".dd-menu").forEach((el) => el.remove());
});

describe("dropdown: trigger renders selected label", () => {
  it("shows the label of the current value on initial render", () => {
    const trigger = mountTrigger("comfortable", [
      ["compact", "Compact"],
      ["comfortable", "Comfortable"],
      ["roomy", "Roomy"],
    ]);
    expect(trigger.querySelector<HTMLElement>(".dd-label")?.textContent).toBe("Comfortable");
  });

  it("falls back to the raw value when nothing matches (no placeholder)", () => {
    const trigger = mountTrigger("unknown", [["a", "A"], ["b", "B"]]);
    expect(trigger.querySelector<HTMLElement>(".dd-label")?.textContent).toBe("unknown");
  });
});

describe("dropdown: menu opens and closes", () => {
  it("clicking the trigger opens a menu in the DOM", () => {
    const trigger = mountTrigger("a", [["a", "A"], ["b", "B"]]);
    expect(document.querySelector(".dd-menu")).toBeNull();
    trigger.click();
    expect(document.querySelector(".dd-menu")).not.toBeNull();
  });

  it("the menu lists every option", () => {
    const trigger = mountTrigger("a", [
      ["a", "Alpha"], ["b", "Beta"], ["c", "Gamma"],
    ]);
    trigger.click();
    const rows = document.querySelectorAll(".dd-menu .dd-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".dd-row-label")?.textContent).toBe("Alpha");
    expect(rows[1].querySelector(".dd-row-label")?.textContent).toBe("Beta");
    expect(rows[2].querySelector(".dd-row-label")?.textContent).toBe("Gamma");
  });

  it("the current value's row is marked selected + shows a check glyph", () => {
    const trigger = mountTrigger("b", [["a", "A"], ["b", "B"], ["c", "C"]]);
    trigger.click();
    const rows = [...document.querySelectorAll<HTMLElement>(".dd-menu .dd-row")];
    expect(rows.map((r) => r.classList.contains("selected"))).toEqual([false, true, false]);
    expect(rows[1].querySelector(".dd-row-check svg")).not.toBeNull();
    expect(rows[0].querySelector(".dd-row-check svg")).toBeNull();
  });

  it("pressing Escape closes the menu", () => {
    const trigger = mountTrigger("a", [["a", "A"], ["b", "B"]]);
    trigger.click();
    expect(document.querySelector(".dd-menu")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".dd-menu")).toBeNull();
  });

  it("clicking outside the menu closes it", () => {
    const trigger = mountTrigger("a", [["a", "A"], ["b", "B"]]);
    trigger.click();
    expect(document.querySelector(".dd-menu")).not.toBeNull();
    // Simulate a click somewhere in the document, outside both trigger+menu.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".dd-menu")).toBeNull();
  });
});

describe("dropdown: selecting an option", () => {
  it("clicking a row calls onChange with the chosen value + closes the menu", () => {
    const calls: string[] = [];
    const trigger = mountTrigger("a", [["a", "A"], ["b", "B"], ["c", "C"]], (v) => calls.push(v));
    trigger.click();
    const rows = document.querySelectorAll<HTMLElement>(".dd-menu .dd-row");
    rows[2].click();
    expect(calls).toEqual(["c"]);
    expect(document.querySelector(".dd-menu")).toBeNull();
  });

  it("after selecting, the trigger LABEL UPDATES immediately (fixes the stale-seg-ctl regression)", () => {
    const trigger = mountTrigger("a", [["a", "Alpha"], ["b", "Beta"]]);
    expect(trigger.querySelector(".dd-label")?.textContent).toBe("Alpha");
    trigger.click();
    const rows = document.querySelectorAll<HTMLElement>(".dd-menu .dd-row");
    rows[1].click();
    // Label reflects the new selection without the caller re-rendering.
    expect(trigger.querySelector(".dd-label")?.textContent).toBe("Beta");
  });

  it("after selecting, re-opening the menu shows the NEW row as selected", () => {
    const trigger = mountTrigger("a", [["a", "Alpha"], ["b", "Beta"], ["c", "Gamma"]]);
    trigger.click();
    document.querySelectorAll<HTMLElement>(".dd-menu .dd-row")[2].click();
    // Re-open
    trigger.click();
    const rows = [...document.querySelectorAll<HTMLElement>(".dd-menu .dd-row")];
    expect(rows.map((r) => r.classList.contains("selected"))).toEqual([false, false, true]);
  });
});

describe("dropdown: keyboard navigation", () => {
  it("ArrowDown then Enter selects the next option", () => {
    const calls: string[] = [];
    const trigger = mountTrigger("a", [["a", "A"], ["b", "B"], ["c", "C"]], (v) => calls.push(v));
    trigger.click();
    // Active row starts on the currently selected one (idx 0).
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(calls).toEqual(["b"]);
  });

  it("ArrowUp clamps at the first option", () => {
    const calls: string[] = [];
    const trigger = mountTrigger("a", [["a", "A"], ["b", "B"]], (v) => calls.push(v));
    trigger.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(calls).toEqual(["a"]);
  });
});
