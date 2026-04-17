# Changelog

## 0.1.0 (Beta)

Initial public beta release.

### Features

- Terminal emulation via xterm.js with full color support
- Multi-pane layouts (vertical and horizontal splits)
- Tabbed windows with auto-naming from shell working directory
- Project launcher (Cmd+O) with auto-detection of Rust, Node, Python, Go, Git projects
- JSON themes in VS Code format with 3 built-in themes
- Community theme repository with in-app installation
- Settings UI with 6 categories (General, Appearance, Font, Keybindings, Workspaces, Advanced)
- Customizable keybindings with capture mode
- Native macOS menu bar
- TOML configuration at `~/.config/kimbo/config.toml`
- Clickable URLs (Cmd+click)

### Tech

- Rust + Tauri 2 backend
- Vanilla TypeScript + xterm.js frontend
- Raw PTY management (no alacritty_terminal dependency)
