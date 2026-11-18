import { describe, it, expect, afterEach } from "vitest";
import "./style.css";

// Small chrome labels used to be forced into uppercase with wide tracking
// ("STARTUP", "INSTALL", "COMING SOON") and headings were set at weight 700.
// Both are text-transform / font-weight effects only a real engine computes,
// so this checks the rendered text (innerText honours text-transform) and the
// computed styles in Chromium against the real stylesheet.

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("chrome labels render in sentence case", () => {
  const cases: Array<[string, string, string]> = [
    ["settings sidebar heading", `<div class="settings"><div class="side-head">Settings</div></div>`, ".side-head"],
    ["settings section heading", `<div class="settings"><div class="section-head">Startup</div></div>`, ".section-head"],
    ["theme card badge", `<div class="theme-card"><span class="badge">Install</span></div>`, ".badge"],
    ["coming soon tag", `<span class="cs-tag">Coming soon</span>`, ".cs-tag"],
  ];

  for (const [name, html, sel] of cases) {
    it(`${name} shows its text as written, without tracking`, () => {
      const host = mount(html);
      const el = host.querySelector<HTMLElement>(sel)!;
      const written = el.textContent!;
      const cs = getComputedStyle(el);
      expect(el.innerText).toBe(written);
      expect(cs.textTransform).toBe("none");
      expect(cs.letterSpacing).toBe("normal");
      expect(parseFloat(cs.fontSize)).toBeGreaterThanOrEqual(10);
      expect(Number(cs.fontWeight)).toBeLessThanOrEqual(600);
    });
  }
});

describe("headings stay at or below weight 600", () => {
  const cases: Array<[string, string, string]> = [
    ["settings title", `<div class="settings"><h1>General</h1></div>`, "h1"],
    ["about name", `<div class="about-identity"><div class="name">Kimbo</div></div>`, ".name"],
    ["welcome title", `<div class="welcome"><h2>Welcome</h2></div>`, "h2"],
  ];

  for (const [name, html, sel] of cases) {
    it(name, () => {
      const el = mount(html).querySelector<HTMLElement>(sel)!;
      expect(Number(getComputedStyle(el).fontWeight)).toBeLessThanOrEqual(600);
    });
  }
});
