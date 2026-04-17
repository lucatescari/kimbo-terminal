import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const settingsSource = readFileSync(resolve(__dirname, "settings.ts"), "utf-8");
const mainTsSource = readFileSync(resolve(__dirname, "main.ts"), "utf-8");
const mainRsSource = readFileSync(resolve(__dirname, "../src-tauri/src/main.rs"), "utf-8");
const themeRsSource = readFileSync(resolve(__dirname, "../src-tauri/src/commands/theme.rs"), "utf-8");

// -------------------------------------------------------------------------
// Fix 1: Theme color previews (unified themes architecture)
// -------------------------------------------------------------------------

describe("fix 1: theme previews with color swatches", () => {
  it("UnifiedTheme interface has swatch preview fields", () => {
    const typesSource = readFileSync(resolve(__dirname, "settings-types.ts"), "utf-8");
    expect(typesSource).toContain("background: string");
    expect(typesSource).toContain("foreground: string");
    expect(typesSource).toContain("accent: string");
    expect(typesSource).toContain("cursor: string");
  });

  it("UnifiedTheme has slug field", () => {
    const typesSource = readFileSync(resolve(__dirname, "settings-types.ts"), "utf-8");
    expect(typesSource).toContain("slug: string");
  });

  it("Rust UnifiedTheme struct has swatches", () => {
    const unifiedRsSource = readFileSync(
      resolve(__dirname, "../crates/kimbo-config/src/theme.rs"),
      "utf-8",
    );
    expect(unifiedRsSource).toContain("pub struct UnifiedTheme");
    expect(unifiedRsSource).toContain("pub swatches: ThemeSwatches");
    expect(unifiedRsSource).toContain("pub background: String");
    expect(unifiedRsSource).toContain("pub foreground: String");
    expect(unifiedRsSource).toContain("pub accent: String");
    expect(unifiedRsSource).toContain("pub cursor: String");
  });

  it("theme-card.ts renders color swatch dots", () => {
    const cardSource = readFileSync(resolve(__dirname, "theme-card.ts"), "utf-8");
    expect(cardSource).toContain("border-radius: 50%");
    expect(cardSource).toContain("renderUnifiedThemeCard");
  });

  it("theme card background uses theme's own background color", () => {
    const cardSource = readFileSync(resolve(__dirname, "theme-card.ts"), "utf-8");
    expect(cardSource).toContain("background: ${t.swatches.background}");
  });
});

// -------------------------------------------------------------------------
// Fix 2: Unified themes (Builtin + Installed + Available via index.json)
// -------------------------------------------------------------------------

describe("fix 2: unified themes", () => {
  it("Rust has list_unified_themes command", () => {
    expect(themeRsSource).toContain("list_unified_themes");
  });

  it("Rust has install_theme + delete_theme commands", () => {
    expect(themeRsSource).toContain("fn install_theme");
    expect(themeRsSource).toContain("fn delete_theme");
  });

  it("commands are registered in main.rs", () => {
    expect(mainRsSource).toContain("list_unified_themes");
    expect(mainRsSource).toContain("install_theme");
    expect(mainRsSource).toContain("delete_theme");
  });

  it("settings UI has Yours and Available subheaders", () => {
    expect(settingsSource).toContain("Yours");
    expect(settingsSource).toContain("Available");
    expect(settingsSource).toContain("list_unified_themes");
  });

  it("settings UI subscribes to themes://community-ready event", () => {
    expect(settingsSource).toContain("themes://community-ready");
  });
});

// -------------------------------------------------------------------------
// Fix 3: Keybinding capture logic (standalone — UI removed, logic preserved
// here as a reference implementation in case the tab is restored later).
// -------------------------------------------------------------------------

describe("fix 3: keybinding capture logic (unit test)", () => {
  function simulateCapture(key: string, metaKey: boolean, ctrlKey: boolean, altKey: boolean, shiftKey: boolean): string | null {
    // Replicate the fixed capture logic.
    if (["Meta", "Control", "Alt", "Shift"].includes(key)) return null;

    const parts: string[] = [];
    if (metaKey) parts.push("cmd");
    if (ctrlKey) parts.push("ctrl");
    if (altKey) parts.push("alt");
    if (shiftKey) parts.push("shift");
    parts.push(key.length === 1 ? key.toLowerCase() : key.toLowerCase());
    return parts.join("-");
  }

  it("captures Cmd+D as cmd-d", () => {
    expect(simulateCapture("d", true, false, false, false)).toBe("cmd-d");
  });

  it("captures Cmd+Shift+D as cmd-shift-d", () => {
    expect(simulateCapture("d", true, false, false, true)).toBe("cmd-shift-d");
  });

  it("captures Ctrl+Alt+T as ctrl-alt-t", () => {
    expect(simulateCapture("t", false, true, true, false)).toBe("ctrl-alt-t");
  });

  it("captures plain key 'a' as just a", () => {
    expect(simulateCapture("a", false, false, false, false)).toBe("a");
  });

  it("captures Cmd+ArrowUp as cmd-arrowup", () => {
    expect(simulateCapture("ArrowUp", true, false, false, false)).toBe("cmd-arrowup");
  });

  it("ignores Meta key alone (modifier-only)", () => {
    expect(simulateCapture("Meta", true, false, false, false)).toBeNull();
  });

  it("ignores Shift key alone", () => {
    expect(simulateCapture("Shift", false, false, false, true)).toBeNull();
  });

  it("ignores Control key alone", () => {
    expect(simulateCapture("Control", false, true, false, false)).toBeNull();
  });
});

// -------------------------------------------------------------------------
// Fix 4: macOS native menu bar
// -------------------------------------------------------------------------

describe("fix 4: macOS native menu bar", () => {
  it("main.rs builds a native menu with Submenu", () => {
    expect(mainRsSource).toContain("Submenu::with_items");
  });

  it("has Kimbo app menu with Settings and Quit", () => {
    expect(mainRsSource).toContain('"Kimbo"');
    expect(mainRsSource).toContain('"settings"');
    expect(mainRsSource).toContain('"Quit Kimbo"');
  });

  it("has File menu with New Tab, Close Pane, Close Tab", () => {
    expect(mainRsSource).toContain('"File"');
    expect(mainRsSource).toContain('"new_tab"');
    expect(mainRsSource).toContain('"close_pane"');
    expect(mainRsSource).toContain('"close_tab"');
  });

  it("has Edit menu with Copy, Paste", () => {
    expect(mainRsSource).toContain('"Edit"');
    expect(mainRsSource).toContain("PredefinedMenuItem::copy");
    expect(mainRsSource).toContain("PredefinedMenuItem::paste");
  });

  it("has View menu with Split options", () => {
    expect(mainRsSource).toContain('"View"');
    expect(mainRsSource).toContain('"split_vertical"');
    expect(mainRsSource).toContain('"split_horizontal"');
  });

  it("has Window menu with Minimize, Maximize, Fullscreen", () => {
    expect(mainRsSource).toContain('"Window"');
    expect(mainRsSource).toContain("PredefinedMenuItem::minimize");
    expect(mainRsSource).toContain("PredefinedMenuItem::fullscreen");
  });

  it("emits menu-action events to frontend", () => {
    expect(mainRsSource).toContain('emit("menu-action"');
    expect(mainRsSource).toContain("on_menu_event");
  });

  it("frontend listens for menu-action events", () => {
    expect(mainTsSource).toContain('"menu-action"');
    expect(mainTsSource).toContain("toggleSettings");
    expect(mainTsSource).toContain("split_vertical");
    expect(mainTsSource).toContain("split_horizontal");
  });

  it("Settings menu item has Cmd+, shortcut", () => {
    expect(mainRsSource).toContain("CmdOrCtrl+,");
  });
});
