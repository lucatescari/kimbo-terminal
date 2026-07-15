#!/usr/bin/env node
// Render scripts/dmg/background.html into a retina multi-representation TIFF
// used as the Kimbo DMG installer background.
//
// Usage:  node scripts/dmg/make-background.mjs
//
// Produces scripts/dmg/dmg-background.tiff (committed). Depends on Playwright
// (already in node_modules) for rendering and macOS `tiffutil` for packing the
// 1x + 2x PNGs into a single HiDPI-aware TIFF that Finder scales crisply.
//
// Sizing note: the canvas is 660x400 and Finder places the background at native
// 1:1 point size (it does NOT scale to fit). A Finder window title bar is 32pt
// tall, so release.sh sets --window-size 660 432 (= 400 + 32) so the 400pt art
// fills the content area exactly — no clipping, no uncovered strip. The caption
// is kept ~40pt above the bottom so it stays visible even if a machine that
// always shows scroll bars shaves the last ~16pt off the content area.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = join(HERE, "background.html");
const PNG_1X = join(HERE, "dmg-background.png");
const PNG_2X = join(HERE, "dmg-background@2x.png");
const TIFF = join(HERE, "dmg-background.tiff");

const WIDTH = 660;
const HEIGHT = 400;

async function shoot(scale, out) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: scale,
    });
    await page.goto("file://" + HTML);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!existsSync(HTML)) throw new Error("missing " + HTML);

  console.log("Rendering 1x → " + PNG_1X);
  await shoot(1, PNG_1X);
  console.log("Rendering 2x → " + PNG_2X);
  await shoot(2, PNG_2X);

  console.log("Packing HiDPI TIFF → " + TIFF);
  execFileSync("tiffutil", ["-cathidpicheck", PNG_1X, PNG_2X, "-out", TIFF], {
    stdio: "inherit",
  });

  // The intermediate PNGs aren't needed once packed.
  rmSync(PNG_1X, { force: true });
  rmSync(PNG_2X, { force: true });

  console.log("Done: " + TIFF);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
