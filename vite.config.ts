import { defineConfig } from "vite";

export default defineConfig({
  root: "src-ui",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    root: ".",
    include: ["src-ui/**/*.test.ts"],
    // `*.browser.test.ts` needs a real browser (see vitest.browser.config.ts);
    // the jsdom runner has no FontFaceSet or real Canvas so those tests can't
    // run here. Run them with `vitest run -c vitest.browser.config.ts`.
    exclude: ["src-ui/**/*.browser.test.ts", "**/node_modules/**"],
  },
});
