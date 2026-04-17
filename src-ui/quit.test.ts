import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Verify Cmd+Q implementation calls the right API.

const keysSource = readFileSync(resolve(__dirname, "keys.ts"), "utf-8");
const mainRsSource = readFileSync(
  resolve(__dirname, "../src-tauri/src/main.rs"),
  "utf-8",
);

describe("Cmd+Q quit behavior", () => {
  it("keys.ts uses invoke('quit_app'), not getCurrentWindow().close()", () => {
    expect(keysSource).toContain('invoke("quit_app")');
    expect(keysSource).not.toContain("getCurrentWindow");
    expect(keysSource).not.toContain(".close()");
  });

  it("keys.ts imports invoke from @tauri-apps/api/core", () => {
    expect(keysSource).toContain("from \"@tauri-apps/api/core\"");
  });

  it("keys.ts does NOT import from @tauri-apps/api/window", () => {
    expect(keysSource).not.toContain("@tauri-apps/api/window");
  });

  it("Rust backend defines quit_app command", () => {
    expect(mainRsSource).toContain("fn quit_app");
    expect(mainRsSource).toContain("app.exit(0)");
  });

  it("quit_app is registered in invoke_handler", () => {
    expect(mainRsSource).toContain("quit_app,");
  });

  it("Cmd+Q shortcut is registered with meta: true", () => {
    // Should have a line like: { key: "q", meta: true, action: ... }
    expect(keysSource).toMatch(/key:\s*"q".*meta:\s*true/);
  });
});
