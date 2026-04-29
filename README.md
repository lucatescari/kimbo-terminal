# Kimbo

A fast, themeable terminal emulator built with Rust and Tauri. Multi-pane layouts, tabbed windows, and a command palette for developer workflows.

<p align="center">
  <a href="https://github.com/lucatescari/kimbo-terminal/actions/workflows/ci.yml"><img src="https://github.com/lucatescari/kimbo-terminal/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/lucatescari/kimbo-terminal/releases/latest"><img src="https://img.shields.io/github/v/release/lucatescari/kimbo-terminal?display_name=tag&sort=semver" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/lucatescari/kimbo-terminal" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="Platform: macOS" />
  <img src="https://img.shields.io/badge/made%20with-%E2%9D%A4-red" alt="Made with love" />
</p>

<p align="center">
  <img src="src-ui/public/kimbo_happy.png" alt="Kimbo (happy)" width="128" />
  <img src="src-ui/public/kimbo_normal.png" alt="Kimbo Terminal" width="128" />
  <img src="src-ui/public/kimbo_surprised.png" alt="Kimbo (surprised)" width="128" />
</p>

> **Beta** — Kimbo is in active development. Expect rough edges. Feedback and contributions welcome.

<p align="center">
  <img src="assets/kimbo-general.gif" alt="Kimbo general features demo" width="720" />
</p>

## Features

- **Multi-pane layouts** — split vertically (Cmd+D) or horizontally (Cmd+Shift+D), nest arbitrarily
- **Tabbed windows** — each tab has its own independent pane layout, drag-and-drop to reorder
- **Command palette** — unified launcher for commands and projects (Cmd+K)
- **Find in scrollback** — search terminal output with regex and case-sensitive modes (Cmd+F)
- **Themeable** — JSON themes (VS Code format), 3 built-in + community theme repo
- **True color (24-bit)** — full color support for modern CLI tools
- **Settings UI** — built-in settings panel (Cmd+,) for theme, font, keybindings, workspaces
- **Configurable keybindings** — all shortcuts customizable via settings or config file
- **Session restore** — tabs and working directories persist across app restarts
- **Clickable URLs** — Cmd+click to open links in your browser
- **Window opacity** — adjustable window transparency
- **Quit confirmation** — optional prompt before closing active panes
- **Drag and drop** — drop files and folders directly into the terminal
- **Welcome screen** — keyboard shortcut intro for first-time users
- **Native macOS menu bar** — standard app menu with all actions

<p align="center">
  <img src="assets/kimbo-cmd-k.gif" alt="Kimbo command palette demo" width="720" />
</p>

## What's New in `feat/osc1337-inline-images`

This branch focuses on better media and rendering behavior in the terminal, plus the latest updates merged from `dev`.

- **Inline images (imgcat / OSC 1337)** — renders iTerm-style inline images directly inside the terminal viewport
- **OSC 1337 cursor-advance preprocessing** — keeps cursor math correct after inline image output (important for tools like `fastfetch`)
- **Transparent ANSI background filtering** — rewrites problematic black background ANSI sequences to preserve window transparency
- **Settings and UX additions from `dev`** — includes recent upstream improvements merged from Luca's `dev` branch

### `imgcat` quick setup

Kimbo can render OSC 1337 inline images, but the `imgcat` command must be installed separately.

```bash
# iTerm2 bundles imgcat; add it to PATH once
mkdir -p ~/.local/bin
ln -sf "/Applications/iTerm.app/Contents/Resources/utilities/imgcat" ~/.local/bin/imgcat

# reload shell
exec zsh

# test
imgcat /path/to/image.png
```

Kimbo supports both default multipart `imgcat` output and legacy `imgcat -l`.

## Tech Stack

- **Rust** — PTY management, config, workspace detection
- **Tauri 2** — native app shell, IPC between Rust and frontend
- **xterm.js** — terminal emulation and rendering
- **TypeScript** — frontend UI (vanilla, no framework)

## Installation

### Build from Source

Requires: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/) (v18+), [Tauri CLI](https://tauri.app/)

```bash
git clone https://github.com/lucatescari/kimbo-terminal.git
cd kimbo-terminal
npm install
cargo install tauri-cli --version "^2"
```

**Development:**
```bash
npm start
```

**Production build (signed .app + .dmg on macOS):**
```bash
npm run build
```

The built app is at `target/release/bundle/macos/Kimbo.app`.

### Download

macOS builds will be available on the [Releases](https://github.com/lucatescari/kimbo-terminal/releases) page soon.

## Configuration

Config file: `~/.config/kimbo/config.toml`

```toml
[general]
default_shell = "/bin/zsh"

[font]
family = "JetBrains Mono"
size = 14.0
line_height = 1.2
ligatures = true

[theme]
name = "kimbo-dark"

[scrollback]
lines = 10000

[cursor]
style = "block"
blink = true

[workspace]
auto_detect = true
scan_dirs = ["~/Projects"]
```

Or use the built-in settings UI (Cmd+,).

## Keybindings

| Shortcut | Action |
|---|---|
| Cmd+K | Command palette |
| Cmd+T | New tab |
| Cmd+Shift+W | Close tab |
| Cmd+D | Split vertically |
| Cmd+Shift+D | Split horizontally |
| Cmd+W | Close pane |
| Cmd+Arrow | Navigate between panes |
| Cmd+] / Cmd+[ | Next / previous tab |
| Cmd+1-9 | Switch to tab by number |
| Cmd+F | Find in scrollback |
| Cmd+, | Settings |
| Cmd+Q | Quit |

All keybindings are customizable in Settings > Keybindings.

## Themes

Kimbo uses JSON themes in VS Code format. Three built-in themes are included:

- **Kimbo Dark** — default dark theme
- **Catppuccin Mocha** — warm dark pastels
- **Catppuccin Latte** — warm light pastels

Community themes are available in Settings > Appearance. You can also create your own — see the [kimbo-themes](https://github.com/lucatescari/kimbo-themes) repo for the format and how to contribute.

Install custom themes by placing `.json` files in `~/.config/kimbo/themes/`.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run in development mode |
| `npm run build` | Production build (.app + .dmg) |
| `npm test` | Run frontend tests |
| `npm run test:rust` | Run Rust tests |
| `npm run test:all` | Run all tests |

## Project Structure

```
kimbo-terminal/
  src-tauri/          # Rust backend (Tauri app, PTY management, commands)
  src-ui/             # TypeScript frontend (xterm.js, tabs, settings, etc.)
  crates/
    kimbo-terminal/   # Raw PTY wrapper (spawn, read/write, resize, CWD)
    kimbo-config/     # Config loading, JSON themes, keybinding definitions
    kimbo-workspace/  # Project detection and directory scanning
```

## Platform Support

- **macOS** — primary platform, fully supported
- **Linux** — planned
- **Windows** — planned

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
