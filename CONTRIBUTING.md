# Contributing to Kimbo

Thanks for your interest in contributing! Kimbo is in early beta and contributions are welcome.

## Getting Started

1. Fork the repo and clone it
2. Install dependencies: `npm install`
3. Install Tauri CLI: `cargo install tauri-cli --version "^2"`
4. Run in dev mode: `npm start`

## Development

**Frontend (TypeScript):** Source is in `src-ui/`. Vanilla TypeScript, no framework. xterm.js handles terminal rendering.

**Backend (Rust):** Tauri app in `src-tauri/`, shared crates in `crates/`. PTY management, config loading, workspace detection.

**Tests:**
```bash
npm test           # Frontend tests (vitest)
npm run test:rust  # Rust tests
npm run test:all   # Everything
```

## Pull Requests

- One feature or fix per PR
- Include tests for new functionality
- Run `npm run test:all` before submitting
- Keep commits focused with clear messages

## Themes

Want to contribute a theme? See the [kimbo-themes](https://github.com/lucatescari/kimbo-themes) repo.

## Reporting Issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- macOS version and Kimbo version

## Code Style

- **Rust:** Standard `rustfmt` formatting
- **TypeScript:** No framework, keep it simple. One module per file, one responsibility per module.
- No unnecessary dependencies. If you can do it in 20 lines, don't add a package.
