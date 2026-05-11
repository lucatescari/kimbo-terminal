# Kimbo Themes

Community themes for [Kimbo](https://github.com/lucatescari/kimbo-terminal), a fast, themeable terminal emulator built with Rust and Tauri.

## Install a Theme

The easiest way is from inside the app: **Settings (Cmd+,) → Appearance**. Browse the **Available** section and click a theme to install and activate it in one step.

To install manually, drop a JSON theme into `~/.config/kimbo/themes/`:

```bash
mkdir -p ~/.config/kimbo/themes

# Replace <theme-slug> with the file name from this repo
curl -o ~/.config/kimbo/themes/<theme-slug>.json \
  https://raw.githubusercontent.com/lucatescari/kimbo-themes/main/themes/<theme-slug>.json
```

Then activate it from Settings → Appearance, or set it in `~/.config/kimbo/config.toml`:

```toml
[theme]
name = "<theme-slug>"
```

## Available Themes

### Dark

| Theme | Author | Preview |
|-------|--------|---------|
| [catppuccin-mocha](themes/catppuccin-mocha.json) | Catppuccin | Warm dark pastels |

### Light

| Theme | Author | Preview |
|-------|--------|---------|
| [catppuccin-latte](themes/catppuccin-latte.json) | Catppuccin | Warm light pastels |

> `kimbo-dark` and `kimbo-light` ship inside the app and don't appear here.

## Create Your Own

See the [theme creation guide](https://github.com/lucatescari/kimbo-terminal/blob/main/docs/themes.md) in the main repo for the full JSON schema and field reference.

## Submit a Theme

1. Fork this repo.
2. Add `themes/<your-theme-slug>.json` (lowercase with hyphens — this becomes the slug used in `config.toml`).
3. Open a PR. CI validates your theme; `index.json` regenerates automatically on merge.

Requirements:
- Top-level fields: `name`, `type` (`"dark"` or `"light"`), `author` (GitHub username), `version`, `colors`.
- Four color keys are required for the swatch preview: `terminal.background`, `terminal.foreground`, `terminal.ansiBlue`, `terminal.cursor`. Other VS Code-style color keys are optional and fall back to defaults.
- Valid `#RRGGBB` hex values.
- Filename matches the slug (lowercase with hyphens).
