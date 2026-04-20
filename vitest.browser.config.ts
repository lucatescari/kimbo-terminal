import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Separate config for tests that need a real browser (Chromium via Playwright)
// to verify things jsdom can't: font loading, @font-face unicode-range, Canvas
// measureText rendering with fallback chains, xterm.js glyph atlas behavior.
// jsdom tests stay on the default config so they keep running fast.
export default defineConfig({
  root: "src-ui",
  server: { port: 5174, strictPort: true },
  test: {
    include: ["**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
