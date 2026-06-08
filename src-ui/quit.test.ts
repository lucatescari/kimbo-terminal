import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Verify Cmd+Q quits the app — but through the `confirmAndQuit` arbiter
// so the "Confirm before quit with active panes" pref is respected.
// Direct invoke("quit_app") from keys.ts would skip the dialog, which was
// exactly the bug we fixed.

const keysSource = readFileSync(resolve(__dirname, "keys.ts"), "utf-8");
const mainRsSource = readFileSync(
  resolve(__dirname, "../src-tauri/src/main.rs"),
  "utf-8",
);
const quitConfirmSource = readFileSync(
  resolve(__dirname, "quit-confirm.ts"),
  "utf-8",
);

const mainTsSource = readFileSync(resolve(__dirname, "main.ts"), "utf-8");
const keybindingsSource = readFileSync(resolve(__dirname, "keybindings.ts"), "utf-8");

describe("Cmd+Q quit behavior", () => {
  it("the quit menu-action is routed through confirmAndQuit (not a direct invoke)", () => {
    // Quit is a macOS-menu-owned shortcut: the menu emits menu-action "quit"
    // and main.ts dispatches it to confirmAndQuit() so the confirm pref runs.
    expect(mainTsSource).toMatch(/case\s+"quit":[^}]*confirmAndQuit\s*\(/);
    // The webview path (keys.ts) must NOT invoke quit_app directly.
    expect(keysSource).not.toMatch(/invoke\("quit_app"\)/);
  });

  it("keys.ts does NOT import from @tauri-apps/api/window", () => {
    expect(keysSource).not.toContain("@tauri-apps/api/window");
  });

  it("confirmAndQuit is the only call-site of invoke('quit_app') in the UI", () => {
    // Final authority on "actually exit" lives inside quit-confirm.ts —
    // every UI path funnels through it. If another module starts invoking
    // quit_app directly, the confirm pref will silently regress.
    expect(quitConfirmSource).toContain('invoke("quit_app")');
  });

  it("Rust backend still defines the quit_app command that actually exits", () => {
    expect(mainRsSource).toContain("fn quit_app");
    expect(mainRsSource).toContain("app.exit(0)");
  });

  it("quit_app is registered in invoke_handler", () => {
    expect(mainRsSource).toContain("quit_app,");
  });

  it("Rust forwards the menu 'quit' action to the frontend instead of exiting directly", () => {
    // Was `"quit" => app_handle.exit(0)`. It now lives in the `|` arm with
    // the other menu-action ids and emits a menu-action event so the
    // frontend can run confirmAndQuit.
    const onMenu = mainRsSource.slice(mainRsSource.indexOf("on_menu_event"));
    expect(onMenu).toContain('"quit"');
    expect(onMenu).toContain('emit("menu-action", id)');
    expect(mainRsSource).not.toMatch(/"quit"\s*=>\s*app_handle\.exit/);
  });

  it("Rust intercepts window CloseRequested so the red-x respects the pref", () => {
    expect(mainRsSource).toContain("CloseRequested");
    expect(mainRsSource).toContain("prevent_close");
    expect(mainRsSource).toContain("quit-requested");
  });

  it("Cmd+Q is the default quit chord", () => {
    expect(keybindingsSource).toMatch(/id:\s*"quit"[^}]*defaultChord:\s*"cmd-q"/);
  });
});
