# Contributing to Kimbo

Thanks for your interest in contributing! Contributions are welcome.

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

Every PR runs CI on GitHub Actions (`.github/workflows/ci.yml`) which executes the same checks on Ubuntu plus a `cargo check` for the macOS Tauri app. PRs need a green CI before merging.

## Themes

Want to contribute a theme? See the [kimbo-themes](https://github.com/lucatescari/kimbo-themes) repo.

### Changing `theme-contract.json`

`theme-contract.json` at the repo root is the single description of every colour key a theme may set. Tests in both languages keep it honest: `crates/kimbo-config/src/contract.rs` pins it to the Rust resolver, `src-ui/theme-contract.test.ts` pins it to the CSS variables.

kimbo-themes keeps a **synced copy** so its submission validator can check a theme without fetching across repos, and nothing automatic keeps the two in agreement. If you change the contract here, follow up in a kimbo-themes checkout:

```sh
node scripts/sync-contract.mjs      # copies the contract across
node scripts/gen-readme-table.mjs   # regenerates README's key table
```

Commit both results there. Skipping it leaves kimbo-themes validating submissions against an outdated key list.

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
