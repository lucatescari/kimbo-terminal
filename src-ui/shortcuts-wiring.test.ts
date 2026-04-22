import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Lock-in tests for keyboard-shortcut and menu-action wiring.
 *
 * Why this file exists: v0.3.0 shipped a silent Cmd+W regression — the
 * binding was present and matched, but the handler (`closeActive()`) bailed
 * out on a single-pane tab, so the keystroke became a visible no-op. The
 * existing `keys.test.ts` didn't catch it because it tested a DUPLICATED
 * shortcut table, decoupled from the real `src-ui/keys.ts`.
 *
 * These tests parse the real source files and assert the exact bindings +
 * dispatch targets exist. They're coarse, but they make the "someone edited
 * the shortcut table and forgot a path" class of bug loud instead of silent.
 */

const keysSource = readFileSync(resolve(__dirname, "keys.ts"), "utf-8");
const mainTsSource = readFileSync(resolve(__dirname, "main.ts"), "utf-8");
const mainRsSource = readFileSync(
  resolve(__dirname, "../src-tauri/src/main.rs"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Section 1: keys.ts shortcut → dispatch target
// ---------------------------------------------------------------------------

/**
 * Expect a single-line shortcut entry in keys.ts that binds the given key
 * combo and whose action calls the named handler.
 *
 * The regex matches the shape:
 *   { key: "<key>", meta: true[, shift: true][, ctrl: true], action: () => ...<handler>... }
 *
 * and allows arbitrary whitespace + extra args on the handler call. We only
 * assert the handler NAME appears inside the action arrow body, which is
 * enough to catch "Cmd+W now calls the wrong function" regressions.
 */
function expectShortcut(
  opts: { key: string; shift?: boolean; ctrl?: boolean; handler: string },
) {
  const { key, shift, ctrl, handler } = opts;
  const keyPart = `key:\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`;
  const metaPart = `meta:\\s*true`;
  const shiftPart = shift ? `shift:\\s*true` : null;
  const ctrlPart = ctrl ? `ctrl:\\s*true` : null;
  const props = [keyPart, metaPart, shiftPart, ctrlPart]
    .filter(Boolean)
    .join("[^}]*");
  const actionPart = `action:\\s*\\(\\)\\s*=>\\s*[^}]*\\b${handler}\\b`;
  const re = new RegExp(`\\{\\s*${props}[^}]*${actionPart}[^}]*\\}`, "m");
  if (!re.test(keysSource)) {
    throw new Error(
      `keys.ts is missing a shortcut {key:"${key}"${shift ? ",shift" : ""}${
        ctrl ? ",ctrl" : ""
      },meta} dispatching to ${handler}(). ` +
        `This is the regression-guard for the v0.3.0 Cmd+W silent no-op — ` +
        `if you're renaming a shortcut or its handler, update this test too.`,
    );
  }
}

describe("keys.ts: every shortcut binds to a real dispatch target", () => {
  // --- Tab lifecycle ---
  it("Cmd+T → createTab", () => {
    expectShortcut({ key: "t", handler: "createTab" });
  });

  it("Cmd+Shift+W → confirmAndCloseActiveTab (routes through the busy-check arbiter)", () => {
    expectShortcut({ key: "w", shift: true, handler: "confirmAndCloseActiveTab" });
  });

  it("Cmd+] → nextTab", () => {
    expectShortcut({ key: "]", handler: "nextTab" });
  });

  it("Cmd+[ → prevTab", () => {
    expectShortcut({ key: "[", handler: "prevTab" });
  });

  it("Cmd+1 → switchToTab(0) (tab index 0)", () => {
    expectShortcut({ key: "1", handler: "switchToTab" });
  });

  it("Cmd+9 → switchToTab", () => {
    expectShortcut({ key: "9", handler: "switchToTab" });
  });

  // --- Pane lifecycle ---
  it("Cmd+D → splitActive vertical", () => {
    const re = /\{\s*key:\s*"d"[^}]*meta:\s*true[^}]*action:[^}]*splitActive\("vertical"\)/;
    expect(keysSource).toMatch(re);
  });

  it("Cmd+Shift+D → splitActive horizontal", () => {
    const re = /\{\s*key:\s*"d"[^}]*shift:\s*true[^}]*action:[^}]*splitActive\("horizontal"\)/;
    expect(keysSource).toMatch(re);
  });

  /**
   * This is THE regression guard for the v0.3.0 Cmd+W bug. Cmd+W must
   * dispatch to a handler that does something visible on every layout,
   * including a single-pane tab. `closeActive` alone is NOT enough —
   * it silently bails out on a leaf tree.
   */
  it("Cmd+W → confirmAndCloseActive (routes through the busy-check arbiter)", () => {
    expectShortcut({ key: "w", handler: "confirmAndCloseActive" });
    // Guard: the old v0.3.0 bail-out-silently target is never directly wired.
    const bad = /\{\s*key:\s*"w"[^}]*meta:\s*true[^}]*action:\s*\(\)\s*=>\s*closeActive\(\)\s*\}/;
    expect(keysSource).not.toMatch(bad);
    // And the pre-confirm direct-close wiring is gone too — the whole point
    // of this refactor was to put a dialog between Cmd+W and pane destruction
    // when a child process is running.
    const oldDirect = /\{\s*key:\s*"w"[^}]*meta:\s*true[^}]*action:\s*\(\)\s*=>\s*closeActiveOrTab\(\)\s*\}/;
    expect(keysSource).not.toMatch(oldDirect);
  });

  // --- Pane focus ---
  it("Cmd+ArrowUp → focusDirection horizontal backward", () => {
    const re = /\{\s*key:\s*"ArrowUp"[^}]*action:[^}]*focusDirection\("horizontal",\s*false\)/;
    expect(keysSource).toMatch(re);
  });

  it("Cmd+ArrowDown → focusDirection horizontal forward", () => {
    const re = /\{\s*key:\s*"ArrowDown"[^}]*action:[^}]*focusDirection\("horizontal",\s*true\)/;
    expect(keysSource).toMatch(re);
  });

  it("Cmd+ArrowLeft → focusDirection vertical backward", () => {
    const re = /\{\s*key:\s*"ArrowLeft"[^}]*action:[^}]*focusDirection\("vertical",\s*false\)/;
    expect(keysSource).toMatch(re);
  });

  it("Cmd+ArrowRight → focusDirection vertical forward", () => {
    const re = /\{\s*key:\s*"ArrowRight"[^}]*action:[^}]*focusDirection\("vertical",\s*true\)/;
    expect(keysSource).toMatch(re);
  });

  // --- App-level ---
  it("Cmd+Q → confirmAndQuit (routes through the pref-aware arbiter)", () => {
    expectShortcut({ key: "q", handler: "confirmAndQuit" });
  });

  it("Cmd+, → toggleSettings", () => {
    expectShortcut({ key: ",", handler: "toggleSettings" });
  });

  it("Cmd+O is NOT a shortcut any more (merged into ⌘K → Open project…)", () => {
    // Guards against anyone re-adding the launcher keybinding. Project
    // picking now lives as a mode inside the command palette.
    // A regex like /key:\s*"o"/ would be tricked by comments; match the
    // full property-pair shape so only a real registration fails this.
    expect(keysSource).not.toMatch(/\{\s*key:\s*"o"[^}]*meta:\s*true/);
  });

  it("Cmd+F → toggleFindBar", () => {
    expectShortcut({ key: "f", handler: "toggleFindBar" });
  });
});

// ---------------------------------------------------------------------------
// Section 2: main.ts menu-action handling matches main.rs menu emissions
// ---------------------------------------------------------------------------

/**
 * main.rs defines menu items by id (e.g., "close_pane"), emits them as
 * `menu-action` events when clicked, and main.ts dispatches in a switch.
 * The contract: every id that main.rs emits must have a case in main.ts.
 * If that goes out of sync, the macOS menu silently does nothing.
 */
function extractMenuIdsEmitted(): string[] {
  // Pattern: MenuItem::with_id(handle, "<id>", ... — collect ids used by
  // MenuItem (excluding PredefinedMenuItem, which Tauri handles internally).
  const re = /MenuItem::with_id\([^,]+,\s*"([^"]+)"/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(mainRsSource))) ids.push(m[1]);
  return ids;
}

function extractMenuIdsHandledInRust(): string[] {
  // main.rs handler: `"id1" | "id2" | "id3" => emit("menu-action", id)`.
  // We pick IDs from the on_menu_event match arms. "quit" used to have a
  // direct `=> app_handle.exit(0)` arm but is now forwarded like every
  // other interactive menu item, so it naturally falls out of this regex.
  const section = mainRsSource.slice(mainRsSource.indexOf("on_menu_event"));
  const re = /"([a-z_]+)"(?=\s*(?:=>|[|]))/g;
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) ids.add(m[1]);
  return [...ids];
}

describe("main.ts: menu-action dispatcher covers everything main.rs emits", () => {
  it("main.rs still emits a menu-action event for each interactive menu item", () => {
    // If this test starts failing, main.rs stopped emitting — the whole pipeline is broken.
    expect(mainRsSource).toContain('emit("menu-action", id)');
  });

  it("every MenuItem id in main.rs is forwarded to the frontend (including 'quit')", () => {
    const ids = extractMenuIdsEmitted();
    expect(ids.length).toBeGreaterThan(0);
    const handled = extractMenuIdsHandledInRust();
    for (const id of ids) {
      expect(handled, `menu id "${id}" has no handler in main.rs on_menu_event`).toContain(id);
    }
  });

  it("main.ts switch has a case for every menu-action id main.rs forwards", () => {
    // Keep in sync if you add a new menu item that should trigger frontend
    // behavior. "quit" is in here because we now arbitrate the quit flow
    // from JS — the case calls confirmAndQuit() so the pref is honored.
    const forwarded = [
      "settings",
      "new_tab",
      "close_pane",
      "close_tab",
      "split_vertical",
      "split_horizontal",
      "quit",
    ];
    for (const id of forwarded) {
      expect(mainTsSource, `main.ts has no switch case for menu-action "${id}"`).toContain(`case "${id}"`);
    }
  });

  // Per-case contract: verify each menu-action dispatches to the *right* handler.
  // Same regression-guard style as Cmd+W: catches "someone rewired close_pane
  // to a silent-on-leaf function" without visual inspection.
  it("close_pane → confirmAndCloseActive (goes through busy-check dialog)", () => {
    expect(mainTsSource).toMatch(/case\s+"close_pane":[^}]*confirmAndCloseActive\s*\(/);
    // And the raw direct-close wiring is gone.
    expect(mainTsSource).not.toMatch(/case\s+"close_pane":\s*closeActiveOrTab\(\)/);
    expect(mainTsSource).not.toMatch(/case\s+"close_pane":\s*closeActive\(\)/);
  });

  it("close_tab → confirmAndCloseActiveTab (goes through busy-check dialog)", () => {
    expect(mainTsSource).toMatch(/case\s+"close_tab":[^}]*confirmAndCloseActiveTab\s*\(/);
  });

  it("new_tab → createTab", () => {
    expect(mainTsSource).toMatch(/case\s+"new_tab":\s*createTab\(\)/);
  });

  it("split_vertical → splitActive(\"vertical\")", () => {
    expect(mainTsSource).toMatch(/case\s+"split_vertical":\s*splitActive\("vertical"\)/);
  });

  it("split_horizontal → splitActive(\"horizontal\")", () => {
    expect(mainTsSource).toMatch(/case\s+"split_horizontal":\s*splitActive\("horizontal"\)/);
  });

  it("settings → toggleSettings", () => {
    expect(mainTsSource).toMatch(/case\s+"settings":\s*toggleSettings\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Section 3: accelerator ↔ keyboard-shortcut consistency
// ---------------------------------------------------------------------------

/**
 * If main.rs defines `CmdOrCtrl+W` as the accelerator for `close_pane`, the
 * DOM-level shortcut in keys.ts should also bind Cmd+W. They end up in
 * different code paths (menu click vs. document keydown) but both should
 * fire on the same physical keystroke.
 */
describe("accelerator ↔ keyboard-shortcut consistency", () => {
  function acceleratorFor(menuVarName: string): string | null {
    // Pattern: let <var> = MenuItem::with_id(..., "...", true, Some("<accel>"))?
    const re = new RegExp(
      `let\\s+${menuVarName}\\s*=\\s*MenuItem::with_id\\([^)]*Some\\("([^"]+)"\\)\\)`,
      "m",
    );
    const m = mainRsSource.match(re);
    return m ? m[1] : null;
  }

  it("close_pane accelerator is CmdOrCtrl+W and keys.ts binds Cmd+W", () => {
    const accel = acceleratorFor("close_pane");
    expect(accel).toBe("CmdOrCtrl+W");
    // keys.ts has Cmd+W without shift.
    expect(keysSource).toMatch(/\{\s*key:\s*"w"[^}]*meta:\s*true[^}]*action/);
  });

  it("close_tab accelerator is CmdOrCtrl+Shift+W and keys.ts binds Cmd+Shift+W", () => {
    const accel = acceleratorFor("close_tab");
    expect(accel).toBe("CmdOrCtrl+Shift+W");
    expect(keysSource).toMatch(/\{\s*key:\s*"w"[^}]*meta:\s*true[^}]*shift:\s*true[^}]*action/);
  });

  it("new_tab accelerator is CmdOrCtrl+T and keys.ts binds Cmd+T", () => {
    const accel = acceleratorFor("new_tab");
    expect(accel).toBe("CmdOrCtrl+T");
    expect(keysSource).toMatch(/\{\s*key:\s*"t"[^}]*meta:\s*true[^}]*action/);
  });

  it("settings accelerator is CmdOrCtrl+, and keys.ts binds Cmd+,", () => {
    const accel = acceleratorFor("settings");
    expect(accel).toBe("CmdOrCtrl+,");
    expect(keysSource).toMatch(/\{\s*key:\s*","[^}]*meta:\s*true[^}]*action/);
  });

  it("quit accelerator is CmdOrCtrl+Q and keys.ts binds Cmd+Q", () => {
    const accel = acceleratorFor("quit");
    expect(accel).toBe("CmdOrCtrl+Q");
    expect(keysSource).toMatch(/\{\s*key:\s*"q"[^}]*meta:\s*true[^}]*action/);
  });

  it("split_vertical accelerator is CmdOrCtrl+D and keys.ts binds Cmd+D", () => {
    const accel = acceleratorFor("split_v");
    expect(accel).toBe("CmdOrCtrl+D");
    expect(keysSource).toMatch(/\{\s*key:\s*"d"[^}]*meta:\s*true[^}]*action/);
  });

  it("split_horizontal accelerator is CmdOrCtrl+Shift+D and keys.ts binds Cmd+Shift+D", () => {
    const accel = acceleratorFor("split_h");
    expect(accel).toBe("CmdOrCtrl+Shift+D");
    expect(keysSource).toMatch(/\{\s*key:\s*"d"[^}]*meta:\s*true[^}]*shift:\s*true[^}]*action/);
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
// Section 4: keys.ts hygiene — no inline no-op actions
// ---------------------------------------------------------------------------

describe("keys.ts: every shortcut action references a named function", () => {
  /**
   * A shortcut's action body should always contain at least one function
   * call. Empty arrow bodies (`() => {}`) or `() => undefined` would be
   * the exact "silent no-op" class of bug that bit us with Cmd+W.
   *
   * We extract every `action: () => ...` body up to the next `}` and check
   * it contains `(` (a function call). Crude, but it catches the pattern.
   */
  it("no shortcut has an empty or no-op action body", () => {
    // Match only shortcut entries — i.e., objects that open with `{ key: "..."`.
    // The pre-fix regex accidentally caught the interface's
    // `action: () => void;` type signature, which isn't a real action body.
    const re = /\{\s*key:\s*"[^"]+"[^}]*action:\s*\(\)\s*=>\s*([^,}][^,}]*)/g;
    const bodies: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(keysSource))) bodies.push(m[1].trim());
    expect(bodies.length).toBeGreaterThan(10); // sanity: real table has ~20+
    for (const body of bodies) {
      expect(body, `action body "${body}" looks like a no-op`).not.toMatch(/^(\{\s*\}|undefined|null|void\s+0|void\b)/);
      // Must contain an opening parenthesis of a function call (either direct
      // or inside a block). Covers both `() => fn()` and `() => { ...; fn(); }`.
      expect(body, `action body "${body}" contains no function call`).toMatch(/\(/);
    }
  });
});
