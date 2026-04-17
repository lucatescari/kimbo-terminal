# Kimbo Themes

Community themes for [Kimbo](https://github.com/kimbo-terminal/kimbo), the GPU-accelerated terminal emulator.

## Install a Theme

```bash
# Create the themes directory
mkdir -p ~/.config/kimbo/themes

# Download a theme (replace <theme-name> with the one you want)
curl -o ~/.config/kimbo/themes/<theme-name>.toml \
  https://raw.githubusercontent.com/kimbo-terminal/kimbo-themes/main/themes/<theme-name>.toml
```

Then set it in `~/.config/kimbo/config.toml`:

```toml
[theme]
name = "<theme-name>"
```

Restart Kimbo to apply.

## Available Themes

### Dark

| Theme | Author | Preview |
|-------|--------|---------|
| [kimbo-dark](themes/kimbo-dark.toml) | Kimbo | Built-in default |
| [catppuccin-mocha](themes/catppuccin-mocha.toml) | Catppuccin | Warm dark pastels |

### Light

| Theme | Author | Preview |
|-------|--------|---------|
| [catppuccin-latte](themes/catppuccin-latte.toml) | Catppuccin | Warm light pastels |

## Create Your Own

See the [theme creation guide](https://github.com/kimbo-terminal/kimbo/blob/main/docs/themes.md) in the main repo.

## Submit a Theme

1. Fork this repo
2. Add your `.toml` file to `themes/`
3. Open a PR

Requirements:
- Must include `name`, `version`, `author`
- All 25 color fields required
- Valid `#RRGGBB` hex values
- Filename matches the `name` field
