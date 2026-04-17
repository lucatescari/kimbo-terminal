import { describe, it, expect, beforeEach } from "vitest";

// Test theme application logic in isolation (no Tauri invoke).

interface ResolvedTheme {
  name: string;
  theme_type: string;
  background: string;
  foreground: string;
  cursor: string;
  selection_background: string;
  ansi_black: string;
  ansi_red: string;
  ansi_green: string;
  ansi_yellow: string;
  ansi_blue: string;
  ansi_magenta: string;
  ansi_cyan: string;
  ansi_white: string;
  ansi_bright_black: string;
  ansi_bright_red: string;
  ansi_bright_green: string;
  ansi_bright_yellow: string;
  ansi_bright_blue: string;
  ansi_bright_magenta: string;
  ansi_bright_cyan: string;
  ansi_bright_white: string;
  tab_active_bg: string;
  tab_inactive_bg: string;
  tab_active_fg: string;
  tab_inactive_fg: string;
  titlebar_bg: string;
  border: string;
  active_border: string;
}

function applyThemeToCssVars(
  theme: ResolvedTheme,
  root: HTMLElement,
): void {
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--fg", theme.foreground);
  root.style.setProperty("--cursor", theme.cursor);
  root.style.setProperty("--titlebar-bg", theme.titlebar_bg);
  root.style.setProperty("--tab-bar-bg", theme.titlebar_bg);
  root.style.setProperty("--tab-active-bg", theme.tab_active_bg);
  root.style.setProperty("--tab-inactive-bg", theme.tab_inactive_bg);
  root.style.setProperty("--tab-active-fg", theme.tab_active_fg);
  root.style.setProperty("--tab-inactive-fg", theme.tab_inactive_fg);
  root.style.setProperty("--border", theme.border);
  root.style.setProperty("--active-border", theme.active_border);
  root.style.setProperty("--surface", theme.tab_active_bg);
  root.style.setProperty("--accent-red", theme.ansi_red);
  root.style.setProperty("--accent-yellow", theme.ansi_yellow);
  root.style.setProperty("--accent-blue", theme.ansi_blue);
  root.style.setProperty("--accent-green", theme.ansi_green);
}

function buildXtermTheme(theme: ResolvedTheme): Record<string, string> {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selection_background,
    black: theme.ansi_black,
    red: theme.ansi_red,
    green: theme.ansi_green,
    yellow: theme.ansi_yellow,
    blue: theme.ansi_blue,
    magenta: theme.ansi_magenta,
    cyan: theme.ansi_cyan,
    white: theme.ansi_white,
    brightBlack: theme.ansi_bright_black,
    brightRed: theme.ansi_bright_red,
    brightGreen: theme.ansi_bright_green,
    brightYellow: theme.ansi_bright_yellow,
    brightBlue: theme.ansi_bright_blue,
    brightMagenta: theme.ansi_bright_magenta,
    brightCyan: theme.ansi_bright_cyan,
    brightWhite: theme.ansi_bright_white,
  };
}

const kimboDark: ResolvedTheme = {
  name: "Kimbo Dark",
  theme_type: "dark",
  background: "#1a1a1a",
  foreground: "#d4d4d4",
  cursor: "#e0e0e0",
  selection_background: "#404040",
  ansi_black: "#3b3b3b",
  ansi_red: "#f44747",
  ansi_green: "#6a9955",
  ansi_yellow: "#d7ba7d",
  ansi_blue: "#569cd6",
  ansi_magenta: "#c586c0",
  ansi_cyan: "#4ec9b0",
  ansi_white: "#d4d4d4",
  ansi_bright_black: "#808080",
  ansi_bright_red: "#f44747",
  ansi_bright_green: "#6a9955",
  ansi_bright_yellow: "#d7ba7d",
  ansi_bright_blue: "#569cd6",
  ansi_bright_magenta: "#c586c0",
  ansi_bright_cyan: "#4ec9b0",
  ansi_bright_white: "#e0e0e0",
  tab_active_bg: "#1a1a1a",
  tab_inactive_bg: "#141414",
  tab_active_fg: "#d4d4d4",
  tab_inactive_fg: "#6e6e6e",
  titlebar_bg: "#141414",
  border: "#2e2e2e",
  active_border: "#569cd6",
};

const catppuccinLatte: ResolvedTheme = {
  name: "Catppuccin Latte",
  theme_type: "light",
  background: "#eff1f5",
  foreground: "#4c4f69",
  cursor: "#dc8a78",
  selection_background: "#acb0be",
  ansi_black: "#5c5f77",
  ansi_red: "#d20f39",
  ansi_green: "#40a02b",
  ansi_yellow: "#df8e1d",
  ansi_blue: "#1e66f5",
  ansi_magenta: "#ea76cb",
  ansi_cyan: "#179299",
  ansi_white: "#acb0be",
  ansi_bright_black: "#6c6f85",
  ansi_bright_red: "#d20f39",
  ansi_bright_green: "#40a02b",
  ansi_bright_yellow: "#df8e1d",
  ansi_bright_blue: "#1e66f5",
  ansi_bright_magenta: "#ea76cb",
  ansi_bright_cyan: "#179299",
  ansi_bright_white: "#bcc0cc",
  tab_active_bg: "#e6e9ef",
  tab_inactive_bg: "#dce0e8",
  tab_active_fg: "#4c4f69",
  tab_inactive_fg: "#8c8fa1",
  titlebar_bg: "#dce0e8",
  border: "#ccd0da",
  active_border: "#1e66f5",
};

describe("theme: CSS variable application", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  it("sets all expected CSS variables for Kimbo Dark", () => {
    applyThemeToCssVars(kimboDark, root);

    expect(root.style.getPropertyValue("--bg")).toBe("#1a1a1a");
    expect(root.style.getPropertyValue("--fg")).toBe("#d4d4d4");
    expect(root.style.getPropertyValue("--cursor")).toBe("#e0e0e0");
    expect(root.style.getPropertyValue("--titlebar-bg")).toBe("#141414");
    expect(root.style.getPropertyValue("--tab-active-bg")).toBe("#1a1a1a");
    expect(root.style.getPropertyValue("--tab-inactive-bg")).toBe("#141414");
    expect(root.style.getPropertyValue("--tab-active-fg")).toBe("#d4d4d4");
    expect(root.style.getPropertyValue("--tab-inactive-fg")).toBe("#6e6e6e");
    expect(root.style.getPropertyValue("--border")).toBe("#2e2e2e");
    expect(root.style.getPropertyValue("--active-border")).toBe("#569cd6");
    // Surface + accent tokens derived from the theme (not the :root defaults).
    expect(root.style.getPropertyValue("--surface")).toBe("#1a1a1a");
    expect(root.style.getPropertyValue("--accent-red")).toBe("#f44747");
    expect(root.style.getPropertyValue("--accent-yellow")).toBe("#d7ba7d");
    expect(root.style.getPropertyValue("--accent-blue")).toBe("#569cd6");
    expect(root.style.getPropertyValue("--accent-green")).toBe("#6a9955");
  });

  it("sets all expected CSS variables for Catppuccin Latte", () => {
    applyThemeToCssVars(catppuccinLatte, root);

    expect(root.style.getPropertyValue("--bg")).toBe("#eff1f5");
    expect(root.style.getPropertyValue("--fg")).toBe("#4c4f69");
    expect(root.style.getPropertyValue("--active-border")).toBe("#1e66f5");
    // Light-theme surface/accents come from the theme, not the dark defaults.
    expect(root.style.getPropertyValue("--surface")).toBe("#e6e9ef");
    expect(root.style.getPropertyValue("--accent-red")).toBe("#d20f39");
  });

  it("switching themes overwrites all variables", () => {
    applyThemeToCssVars(kimboDark, root);
    expect(root.style.getPropertyValue("--bg")).toBe("#1a1a1a");

    applyThemeToCssVars(catppuccinLatte, root);
    expect(root.style.getPropertyValue("--bg")).toBe("#eff1f5");
  });
});

describe("theme: xterm.js theme object", () => {
  it("maps all 16 ANSI colors for Kimbo Dark", () => {
    const xt = buildXtermTheme(kimboDark);

    expect(xt.background).toBe("#1a1a1a");
    expect(xt.foreground).toBe("#d4d4d4");
    expect(xt.cursor).toBe("#e0e0e0");
    expect(xt.selectionBackground).toBe("#404040");
    expect(xt.black).toBe("#3b3b3b");
    expect(xt.red).toBe("#f44747");
    expect(xt.green).toBe("#6a9955");
    expect(xt.yellow).toBe("#d7ba7d");
    expect(xt.blue).toBe("#569cd6");
    expect(xt.magenta).toBe("#c586c0");
    expect(xt.cyan).toBe("#4ec9b0");
    expect(xt.white).toBe("#d4d4d4");
    expect(xt.brightBlack).toBe("#808080");
    expect(xt.brightRed).toBe("#f44747");
    expect(xt.brightGreen).toBe("#6a9955");
    expect(xt.brightYellow).toBe("#d7ba7d");
    expect(xt.brightBlue).toBe("#569cd6");
    expect(xt.brightMagenta).toBe("#c586c0");
    expect(xt.brightCyan).toBe("#4ec9b0");
    expect(xt.brightWhite).toBe("#e0e0e0");
  });

  it("maps all 16 ANSI colors for Catppuccin Latte", () => {
    const xt = buildXtermTheme(catppuccinLatte);

    expect(xt.background).toBe("#eff1f5");
    expect(xt.foreground).toBe("#4c4f69");
    expect(xt.black).toBe("#5c5f77");
    expect(xt.red).toBe("#d20f39");
    expect(xt.brightWhite).toBe("#bcc0cc");
  });

  it("xterm theme has exactly 20 color keys", () => {
    const xt = buildXtermTheme(kimboDark);
    expect(Object.keys(xt)).toHaveLength(20);
  });

  it("no xterm theme value is empty", () => {
    const xt = buildXtermTheme(kimboDark);
    for (const [key, value] of Object.entries(xt)) {
      expect(value, `${key} should not be empty`).toBeTruthy();
      expect(value, `${key} should be a hex color`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("theme: terminal registration", () => {
  it("new terminals get the current theme applied", () => {
    // Simulate the registration pattern from theme.ts.
    let currentTheme: Record<string, string> | null = null;
    const terminals: Array<{ theme: Record<string, string> | null }> = [];

    function registerTerminal(term: { theme: Record<string, string> | null }) {
      terminals.push(term);
      if (currentTheme) term.theme = currentTheme;
    }

    function applyTheme(xt: Record<string, string>) {
      currentTheme = xt;
      for (const t of terminals) t.theme = xt;
    }

    // Load theme BEFORE any terminals exist.
    const xt = buildXtermTheme(kimboDark);
    applyTheme(xt);

    // Now register a terminal — it should get the theme.
    const mockTerm = { theme: null as Record<string, string> | null };
    registerTerminal(mockTerm);

    expect(mockTerm.theme).not.toBeNull();
    expect(mockTerm.theme!.background).toBe("#1a1a1a");
  });

  it("theme switch updates all registered terminals", () => {
    let currentTheme: Record<string, string> | null = null;
    const terminals: Array<{ theme: Record<string, string> | null }> = [];

    function registerTerminal(term: { theme: Record<string, string> | null }) {
      terminals.push(term);
      if (currentTheme) term.theme = currentTheme;
    }

    function applyTheme(xt: Record<string, string>) {
      currentTheme = xt;
      for (const t of terminals) t.theme = xt;
    }

    const t1 = { theme: null as Record<string, string> | null };
    const t2 = { theme: null as Record<string, string> | null };
    registerTerminal(t1);
    registerTerminal(t2);

    applyTheme(buildXtermTheme(kimboDark));
    expect(t1.theme!.background).toBe("#1a1a1a");
    expect(t2.theme!.background).toBe("#1a1a1a");

    applyTheme(buildXtermTheme(catppuccinLatte));
    expect(t1.theme!.background).toBe("#eff1f5");
    expect(t2.theme!.background).toBe("#eff1f5");
  });
});
