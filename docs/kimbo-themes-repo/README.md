# Kimbo Themes

Community color themes for [Kimbo Terminal](https://github.com/lucatescari/kimbo-terminal).

Kimbo ships with two built-in themes (`Kimbo Dark` and `Kimbo Light`). Everything in this repo is an additional community theme you can install from the app.

## Installing Themes

Open Kimbo Terminal, go to **Settings** (Cmd+,) > **Appearance**. Installed themes appear in the **Theme** section; the rest are in the **Community gallery** (click to install). Themes are saved to `~/Library/Application Support/kimbo/themes/`.

## Creating a Theme

Themes are JSON files with five required top-level fields: `name`, `type`, `author`, `version`, `colors`. The `colors` map uses VS Code's color theme schema.

### Schema

```json
{
  "name": "Your Theme Name",
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
| `name` | Display name, any string. |
| `type` | `"dark"` or `"light"`. Controls how the card previews. |
| `author` | Your GitHub username (no `@`, no URL). Rendered as `@username` linked to your GitHub profile. |
| `version` | Free-form; semver recommended. Displayed next to author on the card. |
| `colors` | Color map. Four keys are **required**: `terminal.background`, `terminal.foreground`, `terminal.ansiBlue`, `terminal.cursor`. Omitting any of these fails validation. |

### Colour keys

<!-- BEGIN GENERATED KEYS -->

#### Terminal

| Key | Default | Required |
|---|---|---|
| `terminal.background` | `#000000` | yes |
| `terminal.foreground` | `#ffffff` | yes |
| `terminal.cursor` | `#ffffff` | yes |
| `terminal.selectionBackground` | `#444444` | no |

#### ANSI colours

| Key | Default | Required |
|---|---|---|
| `terminal.ansiBlack` | `#000000` | no |
| `terminal.ansiRed` | `#cc0000` | no |
| `terminal.ansiGreen` | `#00cc00` | no |
| `terminal.ansiYellow` | `#cccc00` | no |
| `terminal.ansiBlue` | `#0000cc` | yes |
| `terminal.ansiMagenta` | `#cc00cc` | no |
| `terminal.ansiCyan` | `#00cccc` | no |
| `terminal.ansiWhite` | `#cccccc` | no |
| `terminal.ansiBrightBlack` | `#555555` | no |
| `terminal.ansiBrightRed` | `#ff0000` | no |
| `terminal.ansiBrightGreen` | `#00ff00` | no |
| `terminal.ansiBrightYellow` | `#ffff00` | no |
| `terminal.ansiBrightBlue` | `#0000ff` | no |
| `terminal.ansiBrightMagenta` | `#ff00ff` | no |
| `terminal.ansiBrightCyan` | `#00ffff` | no |
| `terminal.ansiBrightWhite` | `#ffffff` | no |

#### Window chrome

| Key | Default | Required |
|---|---|---|
| `tab.activeBackground` | `#333333` | no |
| `tab.inactiveBackground` | `#1a1a1a` | no |
| `tab.activeForeground` | `#ffffff` | no |
| `tab.inactiveForeground` | `#888888` | no |
| `titleBar.background` | `#1a1a1a` | no |
| `panel.border` | `#333333` | no |
| `panel.activeBorder` | `#0066ff` | no |
<!-- END GENERATED KEYS -->

Two notes on the optional keys above, because they matter more than "optional"
suggests:

- **`panel.activeBorder` is the accent your card shows** — in the gallery and in
  the app's theme picker. Treat it as your theme's signature colour. It used to
  be `terminal.ansiBlue`: that key is still required, but it no longer feeds the
  preview, so tuning ansiBlue to get the card you want tunes the wrong key. Omit
  `panel.activeBorder` and your card shows the generic `#0066ff` default rather
  than a colour of yours.
- **The window-chrome keys are really painted now** (`titleBar.background`,
  `tab.activeBackground`, `tab.inactiveBackground`, `tab.activeForeground`).
  Their defaults are dark whatever your `type` says, so a **light** theme that
  omits them gets dark chrome over a light terminal. Set them explicitly.

### How to contribute

1. Fork this repo.
2. Add `themes/<your-theme-slug>.json` (lowercase, hyphens — becomes the theme slug used by the app).
3. Open a pull request. CI validates every theme and fails if anything is missing or malformed.
4. On merge to `main`, `index.json` is regenerated automatically by the workflow — do not hand-edit it.

### Test locally

In Kimbo: Settings > Appearance > **Import from file**, then pick your JSON. Or copy it in by hand:

```bash
cp themes/your-theme.json ~/Library/Application\ Support/kimbo/themes/
```

Then open Settings > Appearance and select it.
