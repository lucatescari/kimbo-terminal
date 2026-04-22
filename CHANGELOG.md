# Changelog

## 0.6.0

### Features

- Background opacity: the "Background opacity" setting in Settings → General → Window is now live on macOS. A native `NSVisualEffectView` mounts behind the transparent webview and the chrome alpha scales with the slider (0–100), giving a real translucent-window aesthetic.
- Vibrancy uses the `Tooltip` material — the thinnest adaptive macOS material — so low slider values show meaningfully more of what's behind the window.
- Window appearance is pinned to the Kimbo theme via a new `set_window_theme` Tauri command so the vibrancy layer follows the app's light/dark theme instead of the system-wide appearance.
- Overlays (settings, command palette, welcome popup, modals) stay fully opaque at any slider value so their text remains readable.

### Fixes

- Corrected a stale `--bg` masking in `.pane`, `#tab-bar`, `#status-bar`, and `.pane-head` so every chrome surface participates in the translucency rather than only the title bar.
- Overrode xterm.js's default opaque `.xterm-viewport` and `.composition-view` fills so the terminal viewport itself sees the window-level translucency.
- Added a CSS audit test (`src-ui/window-opacity.test.ts`) that scans both our stylesheet and the vendored `xterm.css` for any opaque chrome fill not covered by an override, so this class of regression gets caught before shipping.

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
