# Contributing to Kimbo

Thanks for your interest in contributing! Contributions are welcome.

## Getting Started

You need macOS, Rust (stable) and Node.js 22.22 or later.

1. Fork the repo and clone it
2. Install dependencies: `npm install`
3. Install Tauri CLI: `cargo install tauri-cli --version "^2"`
4. Build the two helper binaries the app bundles (once, and after changing them):
   `cargo build -p kimbo-claude-statusline -p kimbo-claude-notify`
5. Install the browser for the browser tests (once): `npx playwright install chromium`
6. Run in dev mode: `npm start`

## Development

**Frontend (TypeScript):** Source is in `src-ui/`. Vanilla TypeScript, no framework. xterm.js handles terminal rendering.

**Backend (Rust):** Tauri app in `src-tauri/`, shared crates in `crates/`. PTY management, config loading, workspace detection.

**Tests:**
```bash
npm test              # Frontend unit tests (vitest, jsdom)
npm run test:browser  # Browser tests (real headless Chromium)
npm run test:rust     # Rust tests (workspace crates)
npm run check:tests   # Guardrail on browser-test stubs (see below)
npm run test:all      # All of the above
npm run build:frontend  # Type-check: vitest does not run tsc
```

`*.browser.test.ts` files run in real headless Chromium, which has working
WebGL2. Use them for anything jsdom cannot see: fonts, canvas, layout, and the
xterm WebGL renderer. Do not stub `@xterm/addon-webgl` or `@xterm/xterm` there
unless the test does not depend on rendering; `npm run check:tests` (and CI)
fails on a stub without a `// mock-ok(<module>): <reason>` comment directly
above it. See [AGENTS.md](AGENTS.md) for the full testing rules, which apply
to people as much as to coding agents.

The app crate's tests (`cargo test -p kimbo-app`) only build on macOS; CI runs
them in the macOS job.

## Branching

Kimbo runs a single trunk. `main` is the only long-lived branch: work happens
on short-lived branches off `main` and merges straight back.

There is no `develop` branch. The job one would do is already done better by
the rolling **unstable** release channel, which puts a change in front of
people using Kimbo for real work rather than only in front of CI. The flow is:

1. branch off `main`, build, get CI green, merge back
2. cut an unstable release from `main` when it is worth previewing
3. promote that same build to stable once it has held up

Both channels are released from `main`, and that matters: a stable release is
recognised as the promotion of an unstable preview by comparing the git commit
each was built from. Releasing the two channels from different branches would
break that link. See [docs/release-identity.md](docs/release-identity.md).

## Pull Requests

- One feature or fix per PR
- Include tests for new functionality. For a bug fix, check that the new test
  fails without the fix, and say so in the PR
- Tests should check what the user would see, not only that a function was called
- Run `npm run test:all` and `npm run build:frontend` before submitting, plus the
  Rust lint gates CI enforces:
  ```bash
  cargo fmt --all --check
  cargo clippy -p kimbo-config -p kimbo-terminal -p kimbo-workspace \
    -p kimbo-claude-statusline -p kimbo-claude-notify --all-targets -- -D warnings
  ```
- Add an entry under `## Unreleased` in `CHANGELOG.md` for user-facing changes
- Keep commits focused with clear messages

Every PR runs CI on GitHub Actions (`.github/workflows/ci.yml`). Three jobs are
required to pass before merging:

- **test (ubuntu)**: npm audit, rustfmt, clippy, the test guardrail, type-check
  and frontend build, unit tests, browser tests, Rust tests
- **app-check (macos)**: builds the helper binaries, clippy and tests for the
  Tauri app crate
- **cargo audit**: known vulnerabilities in Rust dependencies

## Releasing (maintainer)

`npm run release` runs `scripts/release.sh`, which asks for the channel:

Both channels audit dependencies (`cargo audit`, `npm audit`), build, sign
and notarize, then run `npm run test:release` as the gate.

- **Stable** bumps the version, then commits, tags, pushes and publishes a
  GitHub release.
- **Unstable** builds `X.Y.Z-unstable.N` without touching git and replaces
  the rolling `unstable` pre-release.

It needs a clean tree (`KIMBO_ALLOW_DIRTY=1` overrides, and marks the build),
`cargo install cargo-audit --locked` (`KIMBO_SKIP_AUDIT=1` overrides), `gh`,
`jq`, and the signing secrets in `.env` (see `.env.example`). The script does
not edit `CHANGELOG.md`: rename `## Unreleased` to the version after the
stable release, never between an unstable preview and its promotion.

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
- macOS version and Kimbo version with build id (Settings > About, e.g. `1.2.5 (a2fd4f1)`)
- Update channel (stable, unstable, or built from source)

## Code Style

- **Rust:** Standard `rustfmt` formatting
- **TypeScript:** No framework, keep it simple. One module per file, one responsibility per module.
- No unnecessary dependencies. If you can do it in 20 lines, don't add a package.
