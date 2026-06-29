# Changelog

## Unreleased

### Added
- Screen Pets: optional animated companions that roam over the terminal — floor walkers, a wall-climbing cat, and a flying cockatiel. Throw a ball, pet them, drag them, and add/remove/customize from Settings → Pets. Sprite art from VS Code Pets (MIT).

### Features

- **Multiple windows.** ⌘N opens a new window, each with its own tabs and session. New windows start fresh; closing a window that's running a process asks first. (Quitting the app still closes everything.)
- **Terminal bell.** Programs that ring the bell now flash the pane, badge the tab when it's in the background, and can optionally play a short sound. Toggle both in Settings → General → Bell.
- **Rename tabs.** Double-click a tab (or right-click → Rename) to give it a custom name. Custom names survive restart and aren't overwritten by the working directory.
- **Jump between prompts.** ⌘⇧↑ / ⌘⇧↓ scroll to the previous/next command prompt (requires Kimbo shell integration).
- **Click-to-focus on an inactive window.** Clicking a pane in a background Kimbo window now focuses that pane on the first click, so you type where you clicked.

### Fixes

- Hardened the PTY manager and the Claude integration install paths against rare panics, so a poisoned lock or unusual filesystem path can no longer crash the app.

### Notes

- Kimbo now documents a minimum of **macOS 13 (Ventura)**. Added a `SECURITY.md` with a private vulnerability-disclosure contact.

## 0.14.1

### Fixes

- Claude Code HUD: the top-bar account email and rate-limit usage % no longer go stale after logging out and back in as a different account. The email refreshes automatically when the active account changes (detected via `~/.claude.json`), and a previous account's usage figures are suppressed instead of shown as current. Figures that haven't been refreshed by a recent Claude turn are now flagged inline as stale. (#8, #9)

## 0.14.0

### Features

- ⌘O opens the command palette straight into projects mode (and toggles back out), so the shortcut always means "show me my projects."

## 0.13.9

### Fixes

- Drag-and-drop: route drops by bounding-rect and tolerate Tauri's mixed pixel reporting, so files/folders land in the pane under the cursor.

## 0.13.8

- Documentation updates.

## 0.13.7

### Features

- Claude rate-limit status line now shows the reset time alongside each usage percentage (e.g. `5h 47% (2h30m)`).

## 0.13.6

### Fixes

- Bounded OSC 8 hyperlink tracking so input lag no longer grows over long sessions (tools like `eza` / `ls --hyperlink` previously accumulated unbounded link ranges).
- Closed a terminal focus-listener race when a pane is disposed before its focus promise resolves.

## 0.13.5

- Reordered the Appearance settings for a clearer layout.

## 0.13.4

### Features

- Theme picker: search themes by name, author, or color, with a dark/light filter; the selected mode persists.

### Fixes

- Claude notifications: stopped 60-second idle pings — only real permission prompts now paint a notification.

## 0.13.3

### Fixes

- OSC 1337 inline images now hide when switching to the alternate screen buffer; ships the `imgcat` helper.

## 0.13.2

### Fixes

- Settings: fixed a flash on nav click, a double-open issue, and a broken "open in editor" action.

## 0.13.1

### Fixes

- Claude status line: gate the "update Claude Code" pill on the reported `version` field rather than on missing rate-limit data.

## 0.13.0

### Features

- Claude Code pane notifications: native macOS notifications and in-app toasts when a Claude session stops or asks for permission, including the tab name and working directory. Click a notification to focus the originating pane. Hooks auto-install on first detection; configurable in Settings → Claude Code (stop / permission / sound toggles) with an install-status row.

## 0.12.0

### Features

- Claude Code rate limits in the HUD: a bundled status-line shim (`kimbo-claude-statusline`) captures Claude Code's 5-hour and 7-day usage windows and renders them in the HUD, replacing tokens/cost when fresh. Smart auto-install on the first detected Claude session (never overwrites an existing custom `statusLine` without consent); toggle in Settings.
- Update toast: a clickable toast on launch when a new version is available.

## 0.11.0

- Maintenance release.

## 0.10.1

### Features

- Inline images (OSC 1337): render iTerm2-style inline images directly in the terminal (works with `imgcat`, `fastfetch`), with magic-byte format sniffing (PNG/JPEG/GIF/WebP, SVG rejected) and a size-bounded base64 decoder.

### Fixes

- Restore window translucency on refocus (macOS).

### Tech

- GitHub Actions CI for pull requests and pushes; README badges; CONTRIBUTING documents the green-CI requirement.

## 0.9.1

### Fixes

- Claude account info now resolves the `claude` binary via a login shell so the packaged `.app` finds it (matching the PATH a Terminal session has).

## 0.9.0

### Features

- Claude Code HUD: a per-pane status strip that detects a running Claude Code session and shows the account email, session id, model, token totals, cost estimate, and duration, with click-to-copy affordances. Configurable in a new Settings → Claude Code panel. Adds a general-purpose toast component.
- Reopen-closed-tab now restores each leaf's scrollback and offers a `claude --resume` line for panes that had a Claude session.

## 0.8.1

### Features

- File → Reopen Closed Tab (⌘⇧T) restores closed tabs, including their split layout and scrollback.

### Fixes

- Kill all PTY sessions cleanly on quit.

## 0.8.0

### Features

- Tab drag-and-drop reordering with a live preview, plus a scrollable tab bar with scroll arrows when tabs overflow.

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
