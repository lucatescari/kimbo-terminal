# Screen Pets — Design

**Date:** 2026-06-29
**Branch:** `feat/screen-pets`
**Status:** Approved design, pending implementation plan

## Summary

Add animated companion pets (in the spirit of the [VS Code Pets](https://github.com/tonybaloney/vscode-pets) extension) that roam over the whole Kimbo window, layered on top of the terminal. Walkers obey gravity (walk the floor, climb walls, fall); flyers roam the air freely. Users can add/remove and customize pets, throw a ball for them to chase, click to pet them, and drag them around.

This is a **new, self-contained feature**. The existing corner Kimbo mascot (`kimbo.ts` / `kimbo.css`) is untouched.

## Goals

- Pets roam the full visible window area, not a confined strip.
- Two locomotion modes: gravity-bound **walkers** and free-flying **flyers**.
- Authentic VS Code Pets look by vendoring their MIT-licensed GIF sprites.
- Interactions: throw a ball, add/remove & customize pets, click to pet, drag to reposition.
- Frontend-only (no Rust/config.toml changes), follows existing module/test conventions.

## Non-Goals

- No changes to the existing Kimbo corner mascot.
- No backend/Rust changes; persistence is localStorage only.
- No multiplayer/shared-state or network features.
- IP-flavored characters (Clippy, Totoro, Deno, etc.) are **excluded by default** (see Licensing).

## Constraints (from CONTRIBUTING.md)

- Vanilla TypeScript, no framework. One module per file, one responsibility per module.
- No unnecessary dependencies.
- Tests required for new functionality; `npm run test:all` green before PR.
- One feature per PR; focused commits.

## Architecture

A self-contained module under `src-ui/screen-pets/`, mirroring the `kimbo.ts` / `toast.ts` pattern (lazy DOM creation, `init`/`dispose`, localStorage prefs, vitest tests).

```
src-ui/
  screen-pets/
    index.ts      # public API: initScreenPets(root), disposeScreenPets(); prefs wiring
    world.ts      # rAF loop + entity registry; stepWorld(entities, bounds, dt) is testable
    pet.ts        # Pet entity: state machine, behavior/target selection, facing
    ball.ts       # Ball entity: gravity + bounce physics
    physics.ts    # shared helpers: gravity, edge/wall collision vs a bounds rect
    sprites.ts    # (species, color, state) -> vendored GIF url
    types.ts      # Species, Color, PetState, Vec2, PetInstance, Bounds, etc.
  screen-pets.css            # overlay layer + pet/ball styling
  public/pets/<species>/...  # vendored MIT GIFs + per-species license.txt
```

### Overlay layer

- Single container `#screen-pets-layer`, mounted as a sibling inside `#app-frame`.
- `position: absolute; inset: 0; pointer-events: none;` — clicks on empty space fall through to the terminal.
- Individual pets and the ball set `pointer-events: auto` so they are clickable/draggable.
- `z-index` sits **above the terminal area but below** modals, command palette, settings, and tooltips, so UI chrome always wins. (Current stack: settings backdrop 200 / panel 300, palette 700, toast 1000. Pets layer ≈ 150.)
- **Bounds** = the `#app-frame` content rect minus the title-bar (top) and status-bar (bottom) insets, so pets walk the visible floor rather than under the chrome. Recomputed on window `resize` and on relevant layout events.

### Wiring

Initialized in `main.ts` next to `initKimbo(...)`, gated on the `screenPetsEnabled` pref. Reacts live to pref changes via `ui-prefs` `onChange`.

## Entity & Physics Model

One `requestAnimationFrame` loop in `world.ts` advances every entity by `dt` each frame. `stepWorld(entities, bounds, dt)` mutates entity positions/states and is the unit-test seam — tests call it with fixed `dt` and a seeded RNG, never real time or real rAF.

The loop **pauses** when there are zero pets or when the document is hidden (`visibilitychange`), and resumes on demand.

### Walkers (gravity-bound)

Species: cat, dog, snake, crab, chicken, turtle, fox, snail, panda (and any other generic ground animal).

- **States:** `falling`, `idle`, `walk`, `run`, `climb`, `lie`, `swipe`, `chase`, `withBall`.
- **Behavior:** pick a random floor target → walk/run toward it → occasionally pause (`idle`/`lie`) or `climb` a side wall partway then drop. Gravity pulls toward the floor each tick. Horizontal facing flips with `transform: scaleX(-1)`.

### Flyers (gravity-free)

Species: cockatiel (and any species whose sprite set includes fly frames).

- **States:** `fly`, `idle`/`hover`, `perch`, `swipe`, `chase`, `withBall`.
- **Behavior:** steer toward a random air target with easing, reflect off edges, occasionally land on a top/side edge to idle, then take off again.

### Ball

- Gravity + floor/wall bounce with damping; settles to rest on the floor.
- While present, nearby idle/walking pets switch to `chase`; on contact a pet enters `withBall` (the `*_with_ball` GIF) briefly, then nudges the ball. Flyers may also chase if airborne ball logic is reached; MVP keeps ball grounded.

### State → sprite

A state change only swaps the `<img>` `src` (the corresponding GIF) and the facing transform — cheap, no per-frame JS animation (the GIF animates itself).

### Caps & defaults

- Hard max **~8** pets for performance and readability.
- When `screenPetsEnabled` flips `true` with an empty roster, seed exactly **one** default pet (a cat, default color) so the feature is immediately visible. The seeded pet is written into the `screenPets` pref like any other.

## Interactions

1. **Throw a ball** — triggered via a command-palette action ("Pets: Throw ball") and a small paw button in the status bar (deliberately *not* a terminal click, to avoid hijacking normal terminal interaction). Ball launches in an arc; pets chase. The ball itself is draggable to re-throw.
2. **Add/remove & customize** — a new "Pets" section in Settings: enable toggle, a list of the user's pets each with species + color dropdowns (using the vendored `icon_*.png` thumbnails) and a name field, plus add/remove buttons. Persisted (see below).
3. **Click to pet** — clicking a pet plays a `swipe`/reaction animation and floats a small heart (reusing the Kimbo heart-overlay CSS approach).
4. **Drag to reposition** — pointer-drag a pet and drop it; a walker falls to the floor from the drop point, a flyer resumes flight.

## Settings & Persistence

Extend the existing localStorage `UiPrefs` (`ui-prefs.ts`, key `kimbo-ui-prefs-v1`):

```ts
screenPetsEnabled: boolean;                       // default false
screenPets: Array<{                               // the roster, default []
  id: string;
  species: Species;
  color: string;
  name: string;
}>;
screenPetsSpeed?: "calm" | "normal" | "lively";   // default "normal"
```

`ui-prefs` `onChange` already broadcasts updates, so the module adds/removes/enables pets live without a restart. No Rust/config.toml changes.

## Assets & Licensing

- Vendor the GIFs actually used into `src-ui/public/pets/<species>/{color}_{state}_8fps.gif`, plus each species' `license.txt`, and the top-level VS Code Pets license as `src-ui/public/pets/VSCODE-PETS-LICENSE` (MIT © 2022 Anthony Shaw).
- Add a credit line in `README.md` and a `CHANGELOG.md` entry.
- **Default vendored set = generic animals only:** cat, dog, snake, crab, chicken, turtle, fox, snail, panda, cockatiel.
- **Excluded by default (IP-flavored):** clippy, totoro, mod, deno, rocky, zappy. Rationale: although the VS Code Pets *repo* is MIT, several characters are third-party IP (Microsoft Clippy, Studio Ghibli Totoro, the Deno/dotnet mascots), which is a risk for an upstream merge. The maintainer can opt to include them later; this keeps the first PR low-risk.

> **Maintainer decision point:** whether to accept any vendored third-party art at all, and whether to later include the IP-flavored species. The design supports either choice — excluded species are simply absent from `public/pets/` and the species enum.

## Testing

Following `kimbo.test.ts` / `toast.test.ts` conventions (jsdom + vitest, `dispose*()` + `vi.useFakeTimers()`, seeded `Math.random` via `vi.spyOn`):

- `physics.test.ts` — gravity pulls a walker to the floor; entities stay within bounds; flyer reflects off edges; ball bounces and damps to rest.
- `pet.test.ts` — state transitions (`falling`→`idle`→`walk`; `chase` when ball near; `withBall` on contact); facing flips with direction; deterministic target selection via injected RNG.
- `screen-pets.test.ts` (integration) — layer mounts only when `screenPetsEnabled`; roster pref reflected in DOM; add/remove updates DOM; `disposeScreenPets()` removes the layer + listeners and cancels rAF; layer is `pointer-events:none` while pets are `auto`.

`npm run test:all` must be green before the PR.

## PR Phasing

This is a large but cohesive single feature. If the maintainer prefers smaller PRs, the natural split is:

- **PR1:** pets that roam (walkers + flyers + settings + persistence + assets).
- **PR2:** the ball/throw interaction.

Implementation will use structured commits so the work can be split if requested, but is planned as one branch (`feat/screen-pets`).

## Risks & Open Questions

- **Performance over xterm/WebGL:** the terminal renders via WebGL; a DOM overlay with `translate3d` transforms is GPU-composited and should be cheap, but we cap pet count and pause the loop when hidden.
- **Bounds accuracy:** the visible floor depends on title-bar/status-bar heights and the `#app-frame` border radius; bounds must track resize and theme/density changes.
- **Asset size:** vendored GIFs add weight to the bundle; we vendor only the colors/states we ship, not the entire upstream `media/` tree.
- **Maintainer acceptance of vendored art** (see decision point above).
