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
  },
});
