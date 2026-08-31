import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./style.css";

// Chrome that is supposed to carry the theme's identity colour was carrying
// blue instead, in two distinct ways that no jsdom test can see:
//
//   1. `input[type=range]` and the find-bar checkboxes had NO css at all, so
//      WebKit painted them with the *macOS system* accent. That ignores the
//      theme entirely, not merely the accent, and it does not move when the
//      theme changes.
//   2. Four chrome surfaces used `--accent-blue` (ANSI blue) where they meant
//      the theme's accent, plus `--kimbo-notify-stop` was a hardcoded hex.
//      ANSI blue is "whatever blue the palette happens to carry", which is the
//      same mistake ff6472d fixed for the rest of the chrome.
//
// Both need computed styles from a real engine, so this test lives here.

// Two accents that are unmistakably not blue, so a regression to either the
// system accent or ANSI blue fails loudly rather than coincidentally passing.
const ACCENT = "rgb(217, 119, 87)"; // #d97757, Claude Red's accent
const WARN = "rgb(249, 226, 175)"; // #f9e2af

let root: HTMLElement;

beforeEach(() => {
  root = document.documentElement;
  // `--accent` derives from `--active-border`, which is what theme.ts writes
  // from the theme's `panel.activeBorder`. Drive it the same way a real theme
  // switch does rather than setting `--accent` directly.
  root.style.setProperty("--active-border", "#d97757");
});

afterEach(() => {
  root.style.removeProperty("--active-border");
  document.body.innerHTML = "";
});

/** The authored cssText of the first rule matching `selector`, across every
 *  stylesheet. Throws rather than returning empty so a renamed selector fails
 *  as a missing rule instead of as a silently passing empty string. */
function findRule(selector: string): string {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // cross-origin sheet
    }
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
        return rule.cssText;
      }
    }
  }
  throw new Error(`no css rule found for "${selector}"`);
}

function resolve(name: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const got = getComputedStyle(probe).color;
  probe.remove();
  return got;
}

describe("theme accent drives every themeable control", () => {
  it("routes the notification-dot colour through the theme accent", () => {
    expect(resolve("--kimbo-notify-stop")).toBe(ACCENT);
  });

  it("routes the permission-notification colour through --warn", () => {
    expect(resolve("--kimbo-notify-perm")).toBe(WARN);
  });

  it("paints the tab notification dot with the accent", () => {
    const tab = document.createElement("div");
    tab.className = "tab tab--badge";
    document.body.appendChild(tab);
    expect(getComputedStyle(tab, "::after").backgroundColor).toBe(ACCENT);
  });

  it("sets a document-wide accent-color so no unstyled native control can fall back to the system blue", () => {
    // The catch-all. Anything native we have not explicitly styled (today the
    // find-bar checkboxes) inherits this instead of the macOS accent.
    expect(getComputedStyle(root).accentColor).toBe(ACCENT);
  });

  it("takes the slider away from WebKit's native system-accent painting", () => {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "range";
    document.body.appendChild(input);
    // This is the whole bug in one assertion. A native range is painted by the
    // engine with the macOS System Settings accent, and no css colour reaches
    // it until `appearance: none` hands us the control.
    expect(getComputedStyle(input).appearance).toBe("none");
  });

  it("fills the slider track and thumb from the accent token", () => {
    // Chromium does not expose computed styles for `::-webkit-slider-*`
    // pseudo-elements, so assert against the authored rules instead. That is
    // the property worth pinning anyway: the rules must reference the token,
    // not a literal colour that would survive a theme switch unchanged.
    const track = findRule(".range::-webkit-slider-runnable-track");
    expect(track).toContain("var(--accent)");
    expect(track).toContain("var(--range-pct");

    const thumb = findRule(".range::-webkit-slider-thumb");
    expect(thumb).toContain("var(--accent)");

    // And the token itself resolves to the theme's colour, which together with
    // the above is what makes the painted result correct.
    expect(resolve("--accent")).toBe(ACCENT);
  });

  it("paints a checked checkbox with the accent", () => {
    const label = document.createElement("label");
    label.className = "find-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    label.appendChild(box);
    document.body.appendChild(label);
    expect(getComputedStyle(box).backgroundColor).toBe(ACCENT);
  });

  it("uses the theme accent, not ANSI blue, for the Claude HUD marks", () => {
    // These read as the theme's colour, so they must not follow the palette's
    // blue channel. Pin ANSI blue somewhere far away to prove they don't.
    root.style.setProperty("--accent-blue", "#0000ff");
    const hud = document.createElement("div");
    hud.className = "claude-hud";
    hud.innerHTML =
      '<span class="claude-hud__badge">x</span><span class="claude-hud__session">y</span>';
    document.body.appendChild(hud);

    expect(getComputedStyle(hud.querySelector(".claude-hud__badge")!).color).toBe(ACCENT);
    expect(getComputedStyle(hud.querySelector(".claude-hud__session")!).color).toBe(ACCENT);
    root.style.removeProperty("--accent-blue");
  });

  it("uses the theme accent for the info toast icon", () => {
    root.style.setProperty("--accent-blue", "#0000ff");
    const toast = document.createElement("div");
    toast.className = "toast toast--info";
    toast.innerHTML = '<span class="toast__icon">i</span>';
    document.body.appendChild(toast);
    expect(getComputedStyle(toast.querySelector(".toast__icon")!).color).toBe(ACCENT);
    root.style.removeProperty("--accent-blue");
  });

  it("keeps --accent-blue itself wired to ANSI blue", () => {
    // The token is not the bug. It is the ANSI channel and theme.ts is right to
    // write it from `ansi_blue`; only the chrome that borrowed it was wrong.
    root.style.setProperty("--accent-blue", "#0000ff");
    expect(resolve("--accent-blue")).toBe("rgb(0, 0, 255)");
    root.style.removeProperty("--accent-blue");
  });

  it("moves every accent-driven surface together when the theme changes", () => {
    root.style.setProperty("--active-border", "#00ff41"); // Matrix
    const green = "rgb(0, 255, 65)";
    expect(resolve("--kimbo-notify-stop")).toBe(green);
    expect(getComputedStyle(root).accentColor).toBe(green);
  });
});
