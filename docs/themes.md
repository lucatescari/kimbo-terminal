# Kimbo Themes

Kimbo ships with two built-in themes (`Kimbo Dark` and `Kimbo Light`) and can install additional community themes from [lucatescari/kimbo-themes](https://github.com/lucatescari/kimbo-themes) with a single click.

## Managing Themes in Settings

Open **Settings** (Cmd+,) → **Appearance**. The single **Themes** section groups everything under two subheaders:

- **Yours** — built-in themes plus any community themes you've installed. Click a card to activate it.
- **Available** — community themes you haven't installed yet. Click a card to install and activate it in one step.

Right-click any card for more options:

| Source | Menu items |
|--------|------------|
| Built-in (Kimbo Dark/Light) | Activate, View author on GitHub |
| Installed (community, on disk) | Activate, Delete, View author on GitHub |
| Available (not yet installed) | Install, View author on GitHub |

`Activate` is disabled if the theme is already active. `Delete` is disabled on the currently active theme with a tooltip reminding you to switch away first.

Installed community themes are saved to `~/.config/kimbo/themes/` as JSON files. The built-ins live inside the Kimbo binary and can't be deleted.

## Theme JSON schema

Community themes are JSON files with five required top-level fields and a VS Code-style color map.

```json
{
  "name": "My Theme",
  "type": "dark",
  "author": "your-github-username",
  "version": "1.0.0",
  "colors": {
    "terminal.background": "#1a1a1a",
    "terminal.foreground": "#d4d4d4",
    "terminal.cursor": "#e0e0e0",
    "terminal.selectionBackground": "#404040",

    "terminal.ansiBlack": "#3b3b3b",
    "terminal.ansiRed": "#f44747",
    "terminal.ansiGreen": "#6a9955",
    "terminal.ansiYellow": "#d7ba7d",
    "terminal.ansiBlue": "#569cd6",
    "terminal.ansiMagenta": "#c586c0",
    "terminal.ansiCyan": "#4ec9b0",
    "terminal.ansiWhite": "#d4d4d4",

    "terminal.ansiBrightBlack": "#808080",
    "terminal.ansiBrightRed": "#f44747",
    "terminal.ansiBrightGreen": "#6a9955",
    "terminal.ansiBrightYellow": "#d7ba7d",
    "terminal.ansiBrightBlue": "#569cd6",
    "terminal.ansiBrightMagenta": "#c586c0",
    "terminal.ansiBrightCyan": "#4ec9b0",
    "terminal.ansiBrightWhite": "#e0e0e0",

    "tab.activeBackground": "#1a1a1a",
    "tab.inactiveBackground": "#141414",
    "tab.activeForeground": "#d4d4d4",
    "tab.inactiveForeground": "#6e6e6e",

    "titleBar.background": "#141414",
    "panel.border": "#2e2e2e",
    "panel.activeBorder": "#569cd6"
  }
}
```

### Required fields

| Field | Notes |
|-------|-------|
| `name` | Display name shown on the card. |
| `type` | `"dark"` or `"light"`. |
| `author` | Your GitHub username — no `@`, no URL. Rendered on the card as `@username` linked to your GitHub profile. |
| `version` | Free-form; semver recommended. Shown next to the author on the card. |
| `colors` | Color map (VS Code schema). Four keys are **required for the swatch preview**: `terminal.background`, `terminal.foreground`, `terminal.ansiBlue`, `terminal.cursor`. The other keys have reasonable defaults. |

## Testing a theme locally

Drop your JSON into the user themes directory:

```bash
mkdir -p ~/.config/kimbo/themes
cp my-theme.json ~/.config/kimbo/themes/
```

Open Settings → Appearance. Your theme appears under **Yours**. Click to activate.

## Publishing a theme

Community themes live in [lucatescari/kimbo-themes](https://github.com/lucatescari/kimbo-themes).

1. Fork the repo.
2. Add `themes/<your-theme-slug>.json` (lowercase with hyphens — this becomes the theme's slug in the app).
3. Open a pull request. CI validates your theme and fails the check if anything is missing or malformed.
4. On merge to `main`, a GitHub Action regenerates `index.json` automatically — contributors don't hand-edit it.

The Kimbo Terminal app fetches `index.json` on demand so newly-merged themes show up under **Available** without an app release.

## Offline behavior

If Kimbo can't reach the community manifest (offline, GitHub rate-limited), the **Available** subheader shows "Community themes unavailable (offline?)". Your installed themes and the built-ins keep working.

If your `config.toml` points at a community theme that isn't yet installed locally, Kimbo tries to auto-install it from the manifest on first launch. If that also fails (offline, or the theme was removed upstream), the app falls back to `kimbo-dark` — **without mutating your config**, so your preference resolves cleanly next time you're online.
