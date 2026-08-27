# Release identity

Every Kimbo build is identified by two things, not one:

```
1.2.1 (a2fnd4f)
 │       └── build id: the short git SHA it was compiled from
 └── version
```

The version says what the release *is*. The build id says what source it was
built *from*. You need both, because the same code ships under two different
version strings depending on which channel it goes out on.

## The problem this solves

The unstable channel publishes `X.Y.Z-unstable.N`, where `X.Y.Z` is the stable
version the preview is a preview *of*. So `1.2.1-unstable.3` is a candidate
for `1.2.1`.

Nothing used to enforce that promise. You could publish `1.2.1-unstable.3`,
land three more commits, and then cut `1.2.1` from a tree the preview had
never covered. Anyone who tested `1.2.1-unstable.3` believed they were testing
`1.2.1`, and they were wrong. The version numbers matched; the code did not.

The build id closes that gap. Two builds with the same build id were compiled
from the same commit, whatever their version strings say.

## The rule

**A stable release built from the same commit as the current unstable build
must carry the version that unstable build declared.**

`scripts/release.sh` enforces this. When you cut a stable release it fetches
the live unstable manifest and compares its `build_id` to `HEAD`:

- **Same commit.** This release is that preview promoted unchanged. The
  version is fixed to the preview's declared target and the bump prompt is
  skipped entirely — there is nothing to decide. The release notes record
  which preview it came from.
- **Different commit.** You get the normal bump prompt, plus a note saying
  what the unstable channel actually shipped, so it is clear the release
  contains code no preview covered. This is a warning and not a refusal:
  a hotfix has to be able to go straight to stable.

## Where the build id comes from

`src-tauri/build.rs` stamps `KIMBO_BUILD_ID` at compile time.

`release.sh` computes the id first and exports it, so `build.rs` uses that
value rather than shelling out to git itself. This matters more than it
looks. The unstable channel rewrites the version files in place for the build
and restores them afterwards, so a tree inspected mid-build always looks
dirty. Pinning the value up front also means the id baked into the binary and
the one written to `latest.json` are the same string by construction, not by
coincidence.

Outside a release, `build.rs` resolves the id itself and appends `-dirty` when
the tree has uncommitted changes. A build with no git metadata at all — a
source tarball — reports `unknown`, and the UI then shows the bare version.

## Dirty builds

A release refuses to run from a dirty tree. The stamped commit would not
describe what was actually built, which makes the id a lie.

`KIMBO_ALLOW_DIRTY=1` overrides this for emergencies. The id is then marked
`-dirty`, and a `-dirty` id never triggers automatic promotion: it names a
commit plus an unrecorded delta, so two dirty builds of the same commit can
differ in content while sharing an id. You can still promote such a build,
you just have to pick the version yourself.

## Where the id shows up

- **In the app.** Settings → About renders `Version 1.2.1 (a2fnd4f)`, so a bug
  report from a preview names something checkoutable.
- **In `latest.json`.** A top-level `build_id` key on both channels. This is
  what the stable path reads back to detect a promotion. `tauri-plugin-updater`
  deserialises the manifest without `deny_unknown_fields`, so clients too old
  to know about the key ignore it rather than failing to parse — verified
  against `tauri-plugin-updater` 2.10.
- **In the GitHub release.** Both the notes and, for unstable, the release
  title.

## Verifying a build's id

Do not grep the binary for it. In an optimized build LLVM materialises short
string literals as immediate constants rather than putting them in read-only
data, so a 7-character build id is simply not present as bytes:

```
436d360           len=7    greppable in release build: no
436d360XX         len=9    greppable in release build: yes
```

It is there and correct — it just isn't a string any more. Debug builds keep
it in rodata, which makes the discrepancy look like a bug when it isn't.

To actually check a build, read it back through the code path that uses it:

```
KIMBO_BUILD_ID=<value> cargo test --release -p kimbo-app --bin kimbo-app build_id
```

or launch the app and look at Settings → About.

## Worked example

```
$ ./scripts/release.sh          # unstable, HEAD = a2fnd4f
Unstable version: v1.2.1-unstable.3 (a2fnd4f)
Promoting this build to stable will release it as v1.2.1.

$ ./scripts/release.sh          # stable, still on a2fnd4f
Unstable channel: v1.2.1-unstable.3 (a2fnd4f)
This commit:      a2fnd4f

Same source as the unstable channel.
v1.2.1-unstable.3 previewed this exact commit and declared v1.2.1 as
its target, so this release is that build promoted. Version is fixed
at v1.2.1 — no bump prompt.
```

Had a commit landed in between, the second run would instead have offered the
usual patch/minor/major menu and noted that the unstable channel shipped
`a2fnd4f`, not the current `HEAD`.
