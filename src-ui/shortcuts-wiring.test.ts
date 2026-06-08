import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ACTIONS } from "./keybindings";

/**
 * Lock-in tests for keyboard-shortcut and menu-action wiring.
 *
 * Architecture (rebindable keybinds):
 *   - keybindings.ts ACTIONS holds each action's id + default chord + a `menu`
 *     flag for the 8 native-menu-owned shortcuts (macOS reserves their
 *     key-equivalents, so they MUST live on the menu).
 *   - Menu-owned actions are dispatched by the native menu → main.rs emits
 *     `menu-action` → main.ts switch. Their accelerators are set in main.rs
 *     from config (the `accel(...)` helper), so rebinds survive restart.
 *   - Every OTHER (webview-owned) action is matched in keys.ts HANDLERS.
 *
 * These guard the "rewired a shortcut to a silent no-op" class of bug
 * (originally the v0.3.0 Cmd+W no-op).
 */

const keysSource = readFileSync(resolve(__dirname, "keys.ts"), "utf-8");
const mainTsSource = readFileSync(resolve(__dirname, "main.ts"), "utf-8");
const mainRsSource = readFileSync(resolve(__dirname, "../src-tauri/src/main.rs"), "utf-8");

const MENU_IDS = ["new_tab", "reopen_tab", "close_tab", "close_pane", "split_vertical", "split_horizontal", "settings", "quit"];

// ---------------------------------------------------------------------------
// Section 1: default chords + menu/webview split (keybindings registry)
// ---------------------------------------------------------------------------

describe("keybindings registry", () => {
  const byId = (id: string) => ACTIONS.find((a) => a.id === id);

  it.each([
    ["new_tab", "cmd-t"], ["reopen_tab", "cmd-shift-t"], ["close_tab", "cmd-shift-w"],
    ["next_tab", "cmd-]"], ["prev_tab", "cmd-["], ["split_vertical", "cmd-d"],
    ["split_horizontal", "cmd-shift-d"], ["close_pane", "cmd-w"], ["focus_up", "cmd-up"],
    ["focus_down", "cmd-down"], ["focus_left", "cmd-left"], ["focus_right", "cmd-right"],
    ["command_palette", "cmd-k"], ["projects", "cmd-o"], ["settings", "cmd-,"],
    ["find", "cmd-f"], ["quit", "cmd-q"],
  ])("%s defaults to %s", (id, expected) => {
    expect(byId(id)?.defaultChord).toBe(expected);
  });

  it("exactly the macOS-reserved / menu-bar actions are flagged menu:true", () => {
    const flagged = ACTIONS.filter((a) => a.menu).map((a) => a.id).sort();
    expect(flagged).toEqual([...MENU_IDS].sort());
  });
});

// ---------------------------------------------------------------------------
// Section 2: keys.ts HANDLERS — webview-owned actions only
// ---------------------------------------------------------------------------

function expectHandler(id: string, handler: string) {
  const re = new RegExp(`${id}:\\s*\\(\\)\\s*=>\\s*[^,]*\\b${handler}\\b`);
  if (!re.test(keysSource)) {
    throw new Error(`keys.ts HANDLERS["${id}"] should dispatch to ${handler}(). Update this test if you rewired it.`);
  }
}

describe("keys.ts: webview-owned actions dispatch correctly", () => {
  it("next_tab → nextTab", () => expectHandler("next_tab", "nextTab"));
  it("prev_tab → prevTab", () => expectHandler("prev_tab", "prevTab"));
  it("command_palette → toggleCommandPalette", () => expectHandler("command_palette", "toggleCommandPalette"));
  it("projects → toggleProjectsPalette", () => expectHandler("projects", "toggleProjectsPalette"));
  it("find → toggleFindBar", () => expectHandler("find", "toggleFindBar"));

  it("focus_up → focusDirection(horizontal,false)", () => {
    expect(keysSource).toMatch(/focus_up:\s*\(\)\s*=>\s*focusDirection\("horizontal",\s*false\)/);
  });
  it("focus_right → focusDirection(vertical,true)", () => {
    expect(keysSource).toMatch(/focus_right:\s*\(\)\s*=>\s*focusDirection\("vertical",\s*true\)/);
  });

  it("⌘1–9 positional tab switching is still wired (fixed, non-rebindable)", () => {
    expect(keysSource).toMatch(/switchToTab\(parseInt/);
  });

  it("menu-owned actions are NOT handled in keys.ts (the native menu owns them)", () => {
    for (const id of MENU_IDS) {
      expect(keysSource, `keys.ts must not define a HANDLERS entry for menu action "${id}"`)
        .not.toMatch(new RegExp(`\\n\\s*${id}:\\s*\\(\\)\\s*=>`));
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3: native menu keeps config-driven accelerators (required on macOS)
// ---------------------------------------------------------------------------

describe("native menu: accelerators are config-driven, not stripped", () => {
  it("each menu item sets its accelerator via the accel(...) helper", () => {
    for (const id of MENU_IDS) {
      expect(mainRsSource, `main.rs should set the "${id}" accelerator via accel("${id}", …)`)
        .toMatch(new RegExp(`accel\\("${id}",\\s*"[^"]+"\\)`));
    }
  });

  it("the accel helper reads persisted overrides (accelerator_for)", () => {
    expect(mainRsSource).toMatch(/keybinds::accelerator_for/);
  });
});

// ---------------------------------------------------------------------------
// Section 4: main.ts menu-action dispatcher covers everything main.rs emits
// ---------------------------------------------------------------------------

function extractMenuIdsEmitted(): string[] {
  const re = /MenuItem::with_id\([^,]+,\s*"([^"]+)"/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(mainRsSource))) ids.push(m[1]);
  return ids;
}

describe("main.ts: menu-action dispatcher covers everything main.rs emits", () => {
  it("main.rs emits a menu-action event", () => {
    expect(mainRsSource).toContain('emit("menu-action", id)');
  });

  it("main.ts has a switch case for every menu-owned action", () => {
    for (const id of MENU_IDS) {
      expect(mainTsSource, `main.ts has no switch case for menu-action "${id}"`).toContain(`case "${id}"`);
    }
  });

  it("close_pane → confirmAndCloseActive (busy-check dialog, not silent-on-leaf)", () => {
    expect(mainTsSource).toMatch(/case\s+"close_pane":[^}]*confirmAndCloseActive\s*\(/);
    expect(mainTsSource).not.toMatch(/case\s+"close_pane":\s*closeActiveOrTab\(\)/);
  });
  it("close_tab → confirmAndCloseActiveTab", () => {
    expect(mainTsSource).toMatch(/case\s+"close_tab":[^}]*confirmAndCloseActiveTab\s*\(/);
  });
  it("new_tab → createTab", () => {
    expect(mainTsSource).toMatch(/case\s+"new_tab":\s*createTab\(\)/);
  });
  it("split_vertical → splitActive(\"vertical\")", () => {
    expect(mainTsSource).toMatch(/case\s+"split_vertical":\s*splitActive\("vertical"\)/);
  });
  it("settings → toggleSettings", () => {
    expect(mainTsSource).toMatch(/case\s+"settings":\s*toggleSettings\(\)/);
  });

  it("emitted ids include the menu-owned set", () => {
    const emitted = extractMenuIdsEmitted();
    for (const id of MENU_IDS) expect(emitted).toContain(id);
  });
});

// ---------------------------------------------------------------------------
// Section 5: main.ts welcome popup wiring
// ---------------------------------------------------------------------------

describe("main: welcome popup wiring", () => {
  it("main.ts imports initWelcome from welcome-popup", () => {
    expect(mainTsSource).toMatch(/initWelcome[\s\S]*from\s+["']\.\/welcome-popup["']/);
  });
  it("main.ts calls initWelcome with the boot config", () => {
    expect(mainTsSource).toMatch(/initWelcome\s*\(\s*cfg\b/);
  });
});

// ---------------------------------------------------------------------------
// Section 6: keys.ts hygiene — no inline no-op handler bodies
// ---------------------------------------------------------------------------

describe("keys.ts: every HANDLERS body calls a function (no silent no-ops)", () => {
  it("no handler body is empty / a no-op", () => {
    const re = /^\s+\w+:\s*\(\)\s*=>\s*(.+?),?\s*$/gm;
    const bodies: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(keysSource))) bodies.push(m[1].trim());
    expect(bodies.length).toBeGreaterThan(5); // ~9 webview actions
    for (const body of bodies) {
      expect(body, `handler body "${body}" looks like a no-op`).not.toMatch(/^(\{\s*\}|undefined|null|void\s+0)$/);
      expect(body, `handler body "${body}" contains no function call`).toMatch(/\(/);
    }
  });
});
