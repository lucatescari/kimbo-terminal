import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./style.css";

// The chrome tokens the theme actually carries. Before the wire-back,
// titleBar.background and the three tab keys were written by theme.ts and read
// by nothing: the title bar, tab strip and tabs all derived from --bg instead,
// so every published theme's chrome colours did nothing. theme-contract.test.ts
// now fails if a contract variable has no reader at all, but only a real engine
// can prove the rules resolve to the theme's colours once painted — which is
// what this file does.
//
// Deliberately garish and mutually distinct values: if a surface regresses to
// --bg (or to a neighbouring token) the assertion names which one it took.
const TITLEBAR = "#ff0000"; // titleBar.background      → 255 0 0
const TABBAR = "#ff00ff"; //   titleBar.background      → 255 0 255
const TAB_ACTIVE_BG = "#0000ff"; //  tab.activeBackground   → 0 0 255
const TAB_INACTIVE_BG = "#00ff00"; // tab.inactiveBackground → 0 255 0
const TAB_ACTIVE_FG = "#ffff00"; //  tab.activeForeground   → 255 255 0
const BG = "#111111"; //        terminal.background — must NOT show up below

// theme.ts writes --titlebar-bg and --tab-bar-bg from the same resolved field
// (titlebar_bg). They are driven apart here on purpose: each rule must read its
// own token, so a rule wired to the wrong one fails instead of coincidentally
// matching.
let root: HTMLElement;

beforeEach(() => {
  root = document.documentElement;
  root.style.setProperty("--bg", BG);
  root.style.setProperty("--titlebar-bg", TITLEBAR);
  root.style.setProperty("--tab-bar-bg", TABBAR);
  root.style.setProperty("--tab-active-bg", TAB_ACTIVE_BG);
  root.style.setProperty("--tab-inactive-bg", TAB_INACTIVE_BG);
  root.style.setProperty("--tab-active-fg", TAB_ACTIVE_FG);

  document.body.innerHTML = `
    <div id="app-frame">
      <div id="title-bar"></div>
      <div id="tab-bar">
        <div class="tab-scroll-region">
          <button type="button" class="tab active" id="probe-active"></button>
          <button type="button" class="tab" id="probe-inactive"></button>
        </div>
      </div>
      <div id="status-bar"></div>
    </div>`;
});

afterEach(() => {
  for (const name of [
    "--bg",
    "--titlebar-bg",
    "--tab-bar-bg",
    "--tab-active-bg",
    "--tab-inactive-bg",
    "--tab-active-fg",
    "--app-alpha",
  ]) {
    root.style.removeProperty(name);
  }
  document.body.innerHTML = "";
});

function bgOf(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element for "${selector}"`);
  return getComputedStyle(el).backgroundColor;
}

/** getComputedStyle has two valid spellings for the same paint: Chromium
 *  serialises a color-mix() result as `color(srgb r g b [/ a])`, while a plain
 *  colour comes back as `rgb()` / `rgba()`. Both are correct answers, so
 *  normalise to 0-255 channels plus alpha and let the assertions pin the
 *  COLOUR rather than the engine's spelling of it. */
function rgba(value: string): string {
  const v = value.trim();
  const srgb =
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((n) => Math.round(parseFloat(n) * 255));
    return `${r} ${g} ${b} / ${srgb[4] === undefined ? 1 : parseFloat(srgb[4])}`;
  }
  const legacy = /^rgba?\(([^)]*)\)$/.exec(v);
  if (legacy) {
    const parts = legacy[1].split(/[,/]/).map((p) => parseFloat(p.trim()));
    return `${Math.round(parts[0])} ${Math.round(parts[1])} ${Math.round(parts[2])} / ${
      parts[3] === undefined ? 1 : parts[3]
    }`;
  }
  // Not a silent pass: an unrecognised form must fail loudly rather than
  // compare unequal for a reason the message does not explain.
  throw new Error(`unrecognised computed colour: "${value}"`);
}

describe("window chrome paints the theme's chrome tokens", () => {
  it("gives the title bar titleBar.background, not the terminal background", () => {
    expect(rgba(bgOf("#title-bar"))).toBe("255 0 0 / 1");
  });

  it("gives the tab strip its own tab-bar token", () => {
    expect(rgba(bgOf("#tab-bar"))).toBe("255 0 255 / 1");
  });

  it("gives the status bar titleBar.background", () => {
    expect(rgba(bgOf("#status-bar"))).toBe("255 0 0 / 1");
  });

  it("gives the active tab tab.activeBackground and tab.activeForeground", () => {
    expect(rgba(bgOf("#probe-active"))).toBe("0 0 255 / 1");
    expect(
      rgba(getComputedStyle(document.querySelector("#probe-active")!).color),
    ).toBe("255 255 0 / 1");
  });

  it("gives an inactive tab tab.inactiveBackground", () => {
    expect(rgba(bgOf("#probe-inactive"))).toBe("0 255 0 / 1");
  });

  it("leaves no chrome surface painted with the terminal background", () => {
    const terminalBg = "17 17 17 / 1";
    for (const sel of ["#title-bar", "#tab-bar", "#status-bar", "#probe-active", "#probe-inactive"]) {
      expect(rgba(bgOf(sel)), `${sel} regressed to --bg`).not.toBe(terminalBg);
    }
  });
});

describe("the chrome tokens stay alpha-aware", () => {
  // window-opacity.test.ts checks the authored text of these declarations; this
  // checks the painted result, which is the property the opacity slider needs.
  it("scales every chrome surface by --app-alpha", () => {
    root.style.setProperty("--app-alpha", "0.5");
    expect(rgba(bgOf("#title-bar"))).toBe("255 0 0 / 0.5");
    expect(rgba(bgOf("#tab-bar"))).toBe("255 0 255 / 0.5");
    expect(rgba(bgOf("#status-bar"))).toBe("255 0 0 / 0.5");
    expect(rgba(bgOf("#probe-active"))).toBe("0 0 255 / 0.5");
    expect(rgba(bgOf("#probe-inactive"))).toBe("0 255 0 / 0.5");
  });
});
