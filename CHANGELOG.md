# Changelog

All notable changes to Kimbo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## Unreleased

### Features

- **Releases are now identified by their source, not just their version.** Every build carries the git commit it was compiled from, shown in Settings → About as `1.2.1 (a2fnd4f)`. A stable release cut from the same commit as the current unstable preview is now automatically released under the version that preview declared, so testing `1.2.1-unstable.3` genuinely means testing `1.2.1`. See [docs/release-identity.md](docs/release-identity.md).

- **Theme previews now show a mock Kimbo window instead of coloured bars.** Each card renders a title bar, a prompt line, output and a block cursor in the theme's own colours, so you can see how text actually reads against the background before switching. Themes you have installed show a genuinely multi-coloured prompt; ones you have not installed yet fall back to fewer colours in the same layout, because the community index only carries four.

### Fixes

- **The terminal scrollbar auto-hides again, and is back to 6px.** xterm 6 replaced the native scrollbar with its own, which silently disabled every scrollbar style and the auto-hide logic at once, leaving a permanently visible 14px bar. It also fixes a longer-standing bug the rewrite exposed: the old thumb was hardcoded white, so on light themes it had been invisible.

### Notes

- Dependencies updated across both ecosystems. `cargo update` clears six RustSec advisories (unsound `anyhow`, `event-listener` and `memmap2`; `rand` 0.7, `scc` and `fxhash` dropped from the tree entirely), taking cargo audit from 24 informational warnings to 18. The rest are the Linux-only GTK3 stack this macOS app never ships. Neither ecosystem reports any vulnerability.
- Major upgrades to xterm 6, Vite 8 (now bundling with Rolldown), TypeScript 7 and `@types/node` 26. CI moves to Node 22 for Vite 8's engine floor.
- A release now refuses to run from a dirty working tree, since the stamped commit would not describe what was built. `KIMBO_ALLOW_DIRTY=1` overrides it.

## 1.2.0 - 2026-08-13

### Features

- **Notifications can now appear at the top of the window.** Settings → Appearance → Notifications switches between bottom (default) and top. The change applies immediately in the current window, including to notifications already on screen.

### Fixes

- **Terminal hyperlinks no longer drift onto unrelated text during long sessions.** Once the scrollback filled up, each new line shifted every stored link position by one without moving the link with it. Ordinary prose would underline as a hyperlink, and Cmd+clicking it could open a URL printed hours earlier. Link positions now follow their line as the buffer scrolls, and are discarded once that line falls out of scrollback.
- **Switching tabs no longer makes the terminal jump and reflow.** Panes in background tabs had their Claude HUD strip removed, so the terminal grew by the strip's height while hidden and shrank again on return. Each change refit the terminal, changed the row count and resized the shell, which showed up as content shifting and flickering for a second or two after every switch. Background panes now keep the strip and skip only the status check.
- **The tab bar no longer flickers or swallows clicks while a TUI animates the terminal title.** Programs like codex update the title with a spinner ~10 times per second; each update used to rebuild the whole tab bar, destroying the tab under the cursor mid-hover and mid-click. Title changes now patch the existing tab label in place.
- Claude notifications now clear after 15 seconds instead of 30, so they no longer read as stuck.

## 1.1.0 - 2026-07-17

### Features

- **You can now follow preview builds from the About window.** Settings → About has an update channel switcher: pick unstable to receive preview releases as they are cut, and use "Reinstall latest stable" to go back. Unstable builds are previews and may be rough. The channel can also be set in config as `updates.channel`, which is `"stable"` unless you change it.
- **Updates install with live progress.** Downloading and installing an update reports streamed progress instead of appearing to hang.
- **The installer window is branded.** The .dmg used to open to a bare white Finder window with no title and visible dot-files. It now has a designed background in the Kimbo palette with a wordmark, a drag arrow, and frosted tiles behind the icons, rendered for retina displays.

### Notes

- `release.sh` gained the unstable channel that publishes those preview builds, and the volume name in the DMG is now "Kimbo".

## 1.0.3 - 2026-07-13

### Fixes

- **The tab bar no longer slides continuously and flashes while you sit on a far-right tab.** With the strip overflowing, three coupled defects fed each other: the scroll arrows were siblings of the scroll region, so toggling them changed the very width used to decide whether they should be visible; every render restarted a smooth scroll animation, including on badge updates and the 2s CWD poll; and every render rebuilt all tab DOM. Arrows are now absolute overlays, scrolling happens only when the active tab is genuinely clipped, and tab buttons are reused rather than wiped.

## 1.0.2 - 2026-07-13

### Notes

- No functional changes. Version bump and rebuild only, with code identical to 1.0.1.

## 1.0.1 - 2026-07-09

### Notes

- No user-facing changes. `cargo audit` in CI now ignores RUSTSEC-2026-0194 and RUSTSEC-2026-0195, two quick-xml advisories reaching Kimbo only transitively through `plist` and the Windows-only `tauri-winrt-notification`, neither of which had an upstream fix available at the time.

## 1.0.0 - 2026-06-29

First stable release. Kimbo is out of beta: the config format, keybindings, and
theme JSON schema are now considered stable for the 1.x line.

### Fixes

- **Closing a secondary window now reaps its shells immediately.** A window opened with ⌘N closes its panes' PTYs (and their whole process trees) the moment the window closes, instead of leaving them running until you quit the app. The global PTY manager is keyed by session rather than window, so the window-close path now tears them down explicitly.

## 0.16.2

### Features

- **Open files from the terminal.** Cmd+click a file path in terminal output to open it in your default app for that file type (your editor for code, Preview for images). Cmd+Shift+click still reveals it in Finder.

### Fixes

- The surviving pane now fills the window after a resize-then-close, instead of leaving a gap.

### Security

- Bumped `rustls-webpki` to 0.103.13 (RUSTSEC-2026-0104).

### Notes

- CI now runs `cargo audit` directly and fails only on actual vulnerabilities.

## 0.16.1

### Security

- Enabled a restrictive Content-Security-Policy for the webview (it was previously disabled), constraining script, style, connect, and image sources.
- Community theme installs now sanitize the theme slug before touching the filesystem and only download over HTTPS from the official `kimbo-themes` host, closing a path-traversal/SSRF gap if the community index were compromised.
- The Claude notify socket is now created with private permissions (`0700` directory, `0600` socket), and the unused shell-open capability/plugin was removed to shrink the IPC surface.

### Performance

- The per-pane Claude HUD process probe now runs only for the visible tab and only when the HUD is enabled, eliminating a continuous `ps` scan across hidden tabs and when the HUD is turned off.

### Notes

- Added GitHub issue and pull-request templates and a Code of Conduct.
- CI now enforces `cargo clippy -D warnings`, `cargo fmt --check`, and a dependency audit.

## 0.16.0

### Features

- **Multiple windows.** ⌘N opens a new window, each with its own tabs and session. New windows start fresh; closing a window that's running a process asks first. (Quitting the app still closes everything.)
- **Terminal bell.** Programs that ring the bell now flash the pane, badge the tab when it's in the background, and can optionally play a short sound. Toggle both in Settings → General → Bell.
- **Rename tabs.** Double-click a tab (or right-click → Rename) to give it a custom name. Custom names survive restart and aren't overwritten by the working directory.
- **Jump between prompts.** ⌘⇧↑ / ⌘⇧↓ scroll to the previous/next command prompt (requires Kimbo shell integration).
- **Click-to-focus on an inactive window.** Clicking a pane in a background Kimbo window now focuses that pane on the first click, so you type where you clicked.

### Fixes

- Hardened the PTY manager and the Claude integration install paths against rare panics, so a poisoned lock or unusual filesystem path can no longer crash the app.
- Session layout is now flushed on quit, so the last layout is never lost.

### Notes

- Kimbo now documents a minimum of **macOS 13 (Ventura)**. Added a `SECURITY.md` with a private vulnerability-disclosure contact.

## 0.15.5

### Fixes

- Restore each tab's working directory on every shell, not just OSC 7-aware ones.

## 0.15.4

### Features

- Settings: keybindings are grouped by category and the whole row is clickable to rebind.

## 0.15.3

### Fixes

- Run blocking Claude Code commands off the main thread, fixing a startup beachball.

## 0.15.2

- Maintenance release.

## 0.15.1

### Fixes

- Light themes are now readable — transparency is only applied when the window is translucent.

## 0.15.0

### Features

- **Opt-in crash reporting.** Sentry-based crash and error reporting for both the Rust backend and the webview, off by default, with a Settings toggle. (#10)
- **Rebindable keybindings.** All shortcuts are rebindable (macOS-aware: the native menu keeps its accelerators), backed by an action registry with chord support, plus a "Reset all settings" action. (#13)
- Clickable file paths: Cmd+click a path in the terminal to reveal it in Finder.

### Fixes

- Settings modal no longer opens twice on first open.

## 0.14.2

### Performance

- Added a comprehensive memory-leak regression suite and fixed the leaks it surfaced: leaked `setInterval` handles across tabs/panes/status-bar, leaked blob URLs on terminal disposal, and unbounded growth of the notification timestamp map. Also optimized the OSC 8 hyperlink hot path.

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
