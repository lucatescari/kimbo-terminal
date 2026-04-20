import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const keysSource = readFileSync(resolve(__dirname, "keys.ts"), "utf-8");
const mainSource = readFileSync(resolve(__dirname, "main.ts"), "utf-8");
const settingsSource = readFileSync(resolve(__dirname, "settings.ts"), "utf-8");

describe("settings: shortcut registration", () => {
  it("Cmd+, shortcut is registered in keys.ts", () => {
    expect(keysSource).toMatch(/key:\s*",".*meta:\s*true/);
  });

  it("keys.ts imports toggleSettings from settings", () => {
    expect(keysSource).toContain("toggleSettings");
    expect(keysSource).toContain('from "./settings"');
  });

  it("Escape closes settings when visible", () => {
    expect(keysSource).toContain("isSettingsVisible()");
    expect(keysSource).toContain("hideSettings()");
  });
});

describe("settings: module exports", () => {
  it("exports initSettings", () => {
    expect(settingsSource).toContain("export function initSettings");
  });

  it("exports toggleSettings", () => {
    expect(settingsSource).toContain("export async function toggleSettings");
  });

  it("exports hideSettings", () => {
    expect(settingsSource).toContain("export function hideSettings");
  });

  it("exports isSettingsVisible", () => {
    expect(settingsSource).toContain("export function isSettingsVisible");
  });
});

describe("settings: categories", () => {
  it("has General category", () => {
    expect(settingsSource).toContain('"general"');
    expect(settingsSource).toContain('"General"');
  });

  it("has Appearance category with theme selector", () => {
    expect(settingsSource).toContain('"appearance"');
    expect(settingsSource).toContain("loadTheme");
  });

  it("has Font category", () => {
    expect(settingsSource).toContain('"font"');
    expect(settingsSource).toContain("Terminal font");
    expect(settingsSource).toContain("Size");
  });

  it("has Workspaces category with scan dirs", () => {
    expect(settingsSource).toContain('"workspaces"');
    expect(settingsSource).toContain("scan_dirs");
    expect(settingsSource).toContain("Add directory");
  });

  it("has Advanced category with scrollback and cursor", () => {
    expect(settingsSource).toContain('"advanced"');
    expect(settingsSource).toContain("Scrollback lines");
    expect(settingsSource).toContain("Cursor style");
    expect(settingsSource).toContain("Cursor blink");
  });

  it("has all 5 categories", () => {
    const categories = ["general", "appearance", "font", "workspaces", "advanced"];
    for (const cat of categories) {
      expect(settingsSource).toContain(`"${cat}"`);
    }
  });
});

describe("settings: config persistence", () => {
  it("calls invoke('save_config') to persist changes", () => {
    expect(settingsSource).toContain('invoke("save_config"');
  });

  it("calls invoke('get_config') to load config", () => {
    expect(settingsSource).toContain("get_config");
    expect(settingsSource).toContain("invoke");
  });

  it("calls invoke('list_unified_themes') for theme list", () => {
    expect(settingsSource).toContain("list_unified_themes");
    expect(settingsSource).toContain("invoke");
  });
});

describe("settings: main.ts integration", () => {
  it("main.ts imports initSettings", () => {
    expect(mainSource).toContain("initSettings");
    expect(mainSource).toContain('from "./settings"');
  });

  it("main.ts calls initSettings with terminalArea", () => {
    expect(mainSource).toContain("initSettings(terminalArea)");
  });
});

describe("updates: wired into boot", () => {
  it("main.ts imports initUpdateCheck", () => {
    expect(mainSource).toContain("initUpdateCheck");
    expect(mainSource).toContain('from "./updates"');
  });

  it("main.ts calls initUpdateCheck after config load", () => {
    expect(mainSource).toMatch(/initUpdateCheck\(\s*cfg/);
  });
});

describe("settings: About category", () => {
  it("has About in the Category type and CATEGORIES list", () => {
    expect(settingsSource).toContain('"about"');
    expect(settingsSource).toContain('"About"');
  });

  it("dispatches About in the render switch", () => {
    expect(settingsSource).toMatch(/case "about":\s*void renderAbout/);
  });

  it("renderAbout reads cached update info", () => {
    expect(settingsSource).toContain("getCachedUpdate");
    expect(settingsSource).toContain("forceCheckUpdate");
  });

  it("renders the auto_check toggle", () => {
    expect(settingsSource).toContain("Auto-update");
    expect(settingsSource).toContain("config.updates.auto_check");
  });

  it("opens the release page via openUrl", () => {
    expect(settingsSource).toMatch(/openUrl\(\s*[^)]*release_url/);
  });

  it("shows a sidebar dot when an update is pending", () => {
    expect(settingsSource).toContain("hasPendingUpdate");
  });

  it("links to the GitHub repo", () => {
    expect(settingsSource).toContain("github.com/lucatescari/kimbo-terminal");
  });
});

describe("settings: welcome integration", () => {
  it("AppConfig interface includes welcome section", () => {
    expect(settingsSource).toMatch(/welcome\s*:\s*\{\s*show_on_startup\s*:\s*boolean/);
  });

  it("renderGeneral adds a 'Show welcome on startup' toggle", () => {
    expect(settingsSource).toContain("Show welcome on startup");
    expect(settingsSource).toMatch(/welcome\.show_on_startup/);
  });

  it("renderGeneral adds a 'Show welcome now' button wired to showWelcome", () => {
    expect(settingsSource).toContain("Show welcome now");
    expect(settingsSource).toContain("showWelcome");
  });

  it("settings.ts imports showWelcome from welcome-popup", () => {
    expect(settingsSource).toMatch(/showWelcome[\s\S]*from\s+["']\.\/welcome-popup["']/);
  });
});
