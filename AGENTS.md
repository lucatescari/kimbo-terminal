# Instructions for coding agents

Read by Claude Code (via `CLAUDE.md`), Codex, Cursor and other agents. Human
contributors: the same rules apply to you, see [CONTRIBUTING.md](CONTRIBUTING.md).

Kimbo is a macOS terminal: Tauri 2 (Rust, `src-tauri/`, `crates/`) with a
vanilla TypeScript frontend (`src-ui/`) rendering through xterm.js and its
WebGL addon.

## Testing: prove the behaviour, not the call

A green CI run proves only what the tests look at. PR #38 had a passing test
and still scrambled the text of every pane but one, because its test replaced
the renderer with a fake and checked that a function was called. Rules:

1. **Test what the user would see.** If the change affects what the terminal
   shows, assert on rendered output (pixels, DOM, buffer contents), not on
   "was X called". A spy alone is not proof that a fix works.
2. **Browser tests use the real renderer.** `*.browser.test.ts` runs in real
   headless Chromium, which **has working WebGL2** (`WEBGL_lose_context`
   included). Do not stub `@xterm/addon-webgl` or `@xterm/xterm` there unless
   the test truly does not depend on rendering. CI enforces this:
   `npm run check:tests` fails on a stub without a
   `// mock-ok(<module>): <reason>` comment directly above it. "Headless
   Chromium has no GL" is false and rejected.
   Pattern for render tests: `src-ui/webgl-shared-atlas.browser.test.ts`.
3. **Shared state needs two instances.** Anything module-global (xterm's
   glyph atlas cache, registries, singletons) must be tested with at least two
   panes/terminals, checking the one you did NOT touch.
4. **Show the test fails without the fix.** Before committing a bug fix, run
   the new test against the unfixed code and confirm it fails for the right
   reason. Say so in the PR description.
5. **Never weaken a test to make it pass.** No skipping, loosening
   assertions, or adding mocks to get green. If a test is wrong, explain why
   in the PR.

## Commands

```sh
npm run test:all      # guardrail check + jsdom + browser + Rust tests
npm run test:browser  # needs: npx playwright install chromium
npm run check:tests   # renderer-stub guardrail only
npm run build:frontend  # tsc + vite build
cargo fmt --all --check && cargo clippy --all-targets -- -D warnings
```

Run `npm run test:all` before you say you are done.

## Known traps

- **Sync Tauri commands run on the macOS UI thread.** Anything that shells out
  or does I/O must be `#[tauri::command(async)]`, or the app beachballs.
- **Menu accelerators in `src-tauri/src/main.rs` are load-bearing.** Removing
  them makes ⌘W/⌘Q fall through to macOS defaults.
- **`src-tauri/capabilities/default.json` `"windows"`** scopes every
  permission. A new window label not listed there is silently denied events.
- **Fixed-position overlays must be appended to `document.body`.**
  `#app-frame` has `transform: translateZ(0)`, so it becomes the containing
  block, and `.pane` clips overflow. jsdom cannot see this; use a browser test.
- **xterm's WebGL glyph atlas is shared** by every terminal with the same font.
  Clearing it through one terminal leaves the others with stale glyph
  coordinates; use `clearGlyphAtlasForAllTerminals()` in `src-ui/theme.ts`.

## Writing

- User-facing text (UI copy, changelog, PR descriptions): plain sentences, no
  em dashes.
- Add a `CHANGELOG.md` entry under `## Unreleased` for user-facing changes.
- One fix or feature per PR.
