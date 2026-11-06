#!/usr/bin/env node
// Guardrail: browser tests may not silently stub the terminal renderer.
//
// Browser tests (*.browser.test.ts) run in real headless Chromium, which has a
// working WebGL2 context. Their whole point is to see what jsdom cannot: real
// rendering. A test that stubs WebglAddon can only check that a function was
// called, never what the screen shows. That is how PR #38 shipped a glyph atlas
// clear that scrambled the text of every other pane: its test stubbed the
// addon, and CI was green.
//
// Rule: every vi.mock() of a guarded module in a browser test needs a marker
// comment in the comment block directly above it:
//
//   // mock-ok(@xterm/addon-webgl): <why this test does not need real rendering>
//
// The reason must be real. "Headless Chromium has no GL context" is false and
// is rejected. Tests that are ABOUT rendering must use the real addon; see
// src-ui/webgl-shared-atlas.browser.test.ts for the pattern.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src-ui");
const GUARDED = ["@xterm/addon-webgl", "@xterm/xterm"];
const MIN_REASON = 25;
// Known-false justifications. Headless Chromium reports "WebKit WebGL" with
// WEBGL_lose_context available.
const FALSE_REASONS = [/no (real )?(web)?gl/i, /(doesn't|does not|don't) (give|have|support).{0,30}\bgl\b/i, /without (a )?(real )?(web)?gl/i];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".browser.test.ts")) yield p;
  }
}

const problems = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/vi\.mock\(\s*["']([^"']+)["']/);
    if (!m || !GUARDED.includes(m[1])) return;
    const mod = m[1];
    const where = `${relative(ROOT, file)}:${i + 1}`;
    // Only the comment block directly above this vi.mock counts, so one
    // marker cannot cover several stubs.
    const above = [];
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]); j--) above.push(lines[j]);
    const marker = above
      .map((l) => l.match(/\/\/\s*mock-ok\(([^)]+)\):\s*(.*)$/))
      .find((mm) => mm && mm[1].trim() === mod);
    if (!marker) {
      problems.push(`${where}: stubs ${mod} without a "// mock-ok(${mod}): <reason>" comment above it.`);
      return;
    }
    const reason = marker[2].trim();
    if (reason.length < MIN_REASON) {
      problems.push(`${where}: mock-ok reason for ${mod} is too short to mean anything: "${reason}".`);
    } else if (FALSE_REASONS.some((re) => re.test(reason))) {
      problems.push(`${where}: mock-ok reason claims headless Chromium has no WebGL. It does; test with the real addon.`);
    }
  });
}

if (problems.length) {
  console.error("Browser tests stub the terminal renderer without a valid reason:\n");
  for (const p of problems) console.error("  " + p);
  console.error(
    "\nBrowser tests run in real Chromium with working WebGL2. If the test is about what the\n" +
      "terminal shows, use the real addon (see src-ui/webgl-shared-atlas.browser.test.ts).\n" +
      "If it really does not depend on rendering, add the marker with the reason. See AGENTS.md.",
  );
  process.exit(1);
}
console.log("check-test-mocks: ok");
