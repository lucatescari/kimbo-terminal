#!/bin/bash
set -e

# Kimbo Terminal release script
# Usage: ./scripts/release.sh
# Bumps version, builds, tags, creates GitHub release with .dmg attached.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load secrets from an uncommitted .env at the repo root (gitignored). Put
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD (and any other release secrets) there so
# they don't have to be exported by hand. See .env.example. `set -a` exports
# every assignment made while sourcing so tauri-bundler inherits them.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
  echo -e "${CYAN}Loaded secrets from .env${NC}"
fi

# Validate updater signing secrets UP FRONT — before the version bump — so a
# missing key/password fails fast and never strands a half-bumped tree.
# TAURI_SIGNING_PRIVATE_KEY can be the raw key contents or a path to the .key
# file (tauri-bundler accepts both); TAURI_SIGNING_PRIVATE_KEY_PASSWORD unlocks it.
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  KIMBO_KEY_PATH="${HOME}/.tauri/kimbo_updater.key"
  if [[ -f "$KIMBO_KEY_PATH" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="$KIMBO_KEY_PATH"
  else
    echo -e "${RED}TAURI_SIGNING_PRIVATE_KEY not set and ${KIMBO_KEY_PATH} not found.${NC}"
    echo "Run: npm run tauri -- signer generate -w ~/.tauri/kimbo_updater.key"
    exit 1
  fi
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  echo -e "${RED}TAURI_SIGNING_PRIVATE_KEY_PASSWORD not set.${NC}"
  echo "Put it in .env (see .env.example) or export it before running."
  exit 1
fi

# Release channel: stable bumps version + commits/tags/pushes + publishes a
# normal tagged GitHub release; unstable builds a preview (X.Y.Z-unstable.N)
# with no git mutations and overwrites the rolling "unstable" pre-release.
echo ""
echo -e "${CYAN}Release channel?${NC}"
echo -e "  ${GREEN}1)${NC} Stable    (official release: bumps version, commits, tags)"
echo -e "  ${GREEN}2)${NC} Unstable  (preview build: no git changes, overwrites the 'unstable' pre-release)"
read -p "Choose [1/2]: " CHANNEL_CHOICE
case "$CHANNEL_CHOICE" in
  1) CHANNEL="stable" ;;
  2) CHANNEL="unstable" ;;
  *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
esac

# Get current version from package.json
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

if [[ "$CHANNEL" == "stable" ]]; then
  echo ""
  echo -e "${CYAN}Kimbo Terminal Release${NC}"
  echo -e "Current version: ${YELLOW}v${CURRENT}${NC}"
  echo ""
  echo "Which version segment to bump?"
  echo -e "  ${GREEN}1)${NC} Patch   → v${MAJOR}.${MINOR}.$((PATCH + 1))  (bug fixes)"
  echo -e "  ${GREEN}2)${NC} Minor   → v${MAJOR}.$((MINOR + 1)).0  (new features)"
  echo -e "  ${GREEN}3)${NC} Major   → v$((MAJOR + 1)).0.0  (breaking changes)"
  echo -e "  ${GREEN}4)${NC} Keep    → v${CURRENT}  (use current version as-is)"
  echo ""
  read -p "Choose [1/2/3/4]: " CHOICE

  case $CHOICE in
    1) PATCH=$((PATCH + 1)) ;;
    2) MINOR=$((MINOR + 1)); PATCH=0 ;;
    3) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    4) ;;  # keep current
    *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
  esac

  NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
  TAG="v${NEW_VERSION}"

  # Abort if the tag already exists (avoids clobbering a prior release).
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo -e "${RED}Tag ${TAG} already exists.${NC}"
    exit 1
  fi

  echo ""
  echo -e "New version: ${GREEN}v${NEW_VERSION}${NC}"
  read -p "Continue? [y/N]: " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

if [[ "$CHANNEL" == "unstable" ]]; then
  # Fetch the version currently on the unstable channel (empty if none).
  UNSTABLE_URL="https://github.com/lucatescari/kimbo-terminal/releases/download/unstable/latest.json"
  PREV_UNSTABLE=$(curl -fsSL "$UNSTABLE_URL" 2>/dev/null | jq -r '.version // empty')

  if [[ "$PREV_UNSTABLE" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-unstable\.([0-9]+)$ ]]; then
    PREV_BASE="${BASH_REMATCH[1]}"; PREV_N="${BASH_REMATCH[2]}"
  else
    PREV_BASE=""; PREV_N=0
  fi

  # Default next-stable target = patch bump of the committed stable version.
  DEFAULT_BASE="${MAJOR}.${MINOR}.$((PATCH + 1))"
  if [[ -n "$PREV_BASE" ]] && [[ "$PREV_BASE" != "$CURRENT" ]]; then
    # Reuse the in-flight target and bump N.
    BASE="$PREV_BASE"; N=$((PREV_N + 1))
  else
    read -p "Unstable base target [${DEFAULT_BASE}]: " BASE
    BASE="${BASE:-$DEFAULT_BASE}"; N=1
  fi
  NEW_VERSION="${BASE}-unstable.${N}"
  echo -e "Unstable version: ${GREEN}v${NEW_VERSION}${NC}"
  read -p "Continue? [y/N]: " CONFIRM
  [[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]] || { echo "Aborted."; exit 0; }

  # Edit version files for the build only — never committed. Restored on
  # EXIT (combined below with the DMG_STAGE cleanup trap) so the working
  # tree is clean again even if a later step fails under `set -e`.
  RESTORE_FILES=(package.json src-tauri/tauri.conf.json Cargo.toml src-tauri/Cargo.toml \
    crates/kimbo-terminal/Cargo.toml crates/kimbo-config/Cargo.toml crates/kimbo-workspace/Cargo.toml)
  trap 'git checkout -- "${RESTORE_FILES[@]}" 2>/dev/null; rm -rf "${DMG_STAGE:-}" 2>/dev/null' EXIT
fi

# ---- Step 1: Update version in all files ----
echo ""
echo -e "${CYAN}Updating version numbers...${NC}"

# package.json
sed -i '' "s/\"version\": \"${CURRENT}\"/\"version\": \"${NEW_VERSION}\"/" package.json

# tauri.conf.json
sed -i '' "s/\"version\": \"${CURRENT}\"/\"version\": \"${NEW_VERSION}\"/" src-tauri/tauri.conf.json

# All Cargo.toml files (only the version = "x.y.z" line, not dependency versions)
for f in Cargo.toml src-tauri/Cargo.toml crates/kimbo-terminal/Cargo.toml crates/kimbo-config/Cargo.toml crates/kimbo-workspace/Cargo.toml; do
  sed -i '' "s/^version = \"${CURRENT}\"/version = \"${NEW_VERSION}\"/" "$f"
done

echo -e "  Updated 7 files to v${NEW_VERSION}"

# ---- Step 2: Build signed production release ----
echo ""
echo -e "${CYAN}Building signed production release...${NC}"

# Sign with Developer ID for Gatekeeper.
# Code signing (use cert hash to avoid ambiguity with duplicate cert names).
export APPLE_SIGNING_IDENTITY="44182A302783F4D0ACA0888C54E6CAFC89709828"

# Notarization — Tauri expects these specific env var names:
#   APPLE_API_KEY = the key ID (not the file path!)
#   APPLE_API_ISSUER = the issuer UUID
#   APPLE_API_KEY_PATH = path to .p8 file (auto-discovered from ~/.appstoreconnect/)
export APPLE_API_KEY="${APPLE_API_KEY_ID:-TST7M4RJDJ}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-277572be-01f6-4e99-9a67-336fc6fdc28e}"

# Updater signing secrets are validated at the very top (before the version
# bump) so a missing key/password fails fast without stranding a bump.

# Build only the .app bundle. We skip Tauri's DMG step because macOS System
# Policy (syspolicyd) denies copy-helper from writing to /Volumes/Kimbo/Kimbo.app
# on this machine — a persistent ExecPolicy record from a prior run. We build
# the DMG ourselves below with create-dmg (scripts/dmg/bundle_dmg.sh), which
# stages the app with a plain `cp -R` into a `-mountrandom` disk image instead
# of copy-helper, sidestepping the block (verified: volname "Kimbo" builds and
# mounts cleanly this way).
# `createUpdaterArtifacts: true` in tauri.conf.json makes the bundler also emit
# Kimbo.app.tar.gz + Kimbo.app.tar.gz.sig next to the .app.
npm run tauri -- build --bundles app

APP_PATH="target/release/bundle/macos/Kimbo.app"
UPDATER_TARBALL="target/release/bundle/macos/Kimbo.app.tar.gz"
UPDATER_SIG="${UPDATER_TARBALL}.sig"
DMG_DIR="target/release/bundle/dmg"
DMG_PATH="${DMG_DIR}/Kimbo_${NEW_VERSION}_aarch64.dmg"

if [[ ! -d "$APP_PATH" ]]; then
  echo -e "${RED}App bundle not found at ${APP_PATH}${NC}"
  echo "Build may have failed. Check output above."
  exit 1
fi

echo -e "  ${GREEN}Built:${NC} ${APP_PATH}"

# ---- Step 2b: Verify signing + entitlements ----
echo ""
echo -e "${CYAN}Verifying signed bundle...${NC}"

# Signature verification.
if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Code signature valid"
else
  echo -e "  ${RED}✗${NC} Code signature verification failed:"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH" || true
  exit 1
fi

# Hardened runtime flag (required for notarization).
if codesign -d --verbose=2 "$APP_PATH" 2>&1 | grep -qE 'flags=.*runtime'; then
  echo -e "  ${GREEN}✓${NC} Hardened runtime enabled"
else
  echo -e "  ${RED}✗${NC} Hardened runtime NOT enabled (notarization will fail)"
  exit 1
fi

# Gatekeeper assessment (notarization stapled).
SPCTL_OUT=$(spctl --assess --type execute --verbose "$APP_PATH" 2>&1 || true)
if echo "$SPCTL_OUT" | grep -q "accepted"; then
  echo -e "  ${GREEN}✓${NC} Gatekeeper accepts bundle (notarized + stapled)"
else
  echo -e "  ${YELLOW}⚠${NC} Gatekeeper did not accept:"
  echo "$SPCTL_OUT" | sed 's/^/      /'
fi

# Entitlements dump.
echo ""
echo -e "${CYAN}Entitlements:${NC}"
ENT_PLIST=$(codesign -d --entitlements :- "$APP_PATH" 2>/dev/null || true)
if [[ -z "$ENT_PLIST" ]]; then
  echo -e "  ${YELLOW}(none embedded)${NC}"
else
  if command -v plutil >/dev/null 2>&1; then
    echo "$ENT_PLIST" | plutil -p - 2>/dev/null | sed 's/^/  /' || echo "$ENT_PLIST" | sed 's/^/  /'
  else
    echo "$ENT_PLIST" | sed 's/^/  /'
  fi
fi

# Assert required entitlements are present.
REQUIRED_ENTS=("com.apple.security.network.client")
MISSING_ENTS=()
for ent in "${REQUIRED_ENTS[@]}"; do
  if ! echo "$ENT_PLIST" | grep -q "$ent"; then
    MISSING_ENTS+=("$ent")
  fi
done

if [[ ${#MISSING_ENTS[@]} -gt 0 ]]; then
  echo ""
  echo -e "${RED}Missing required entitlements:${NC}"
  for ent in "${MISSING_ENTS[@]}"; do
    echo -e "  ${RED}✗${NC} ${ent}"
  done
  echo -e "${RED}Aborting — fix src-tauri/entitlements.plist and rebuild.${NC}"
  exit 1
fi

echo -e "  ${GREEN}All required entitlements present${NC}"

# ---- Step 2c: Bundle, sign, notarize, and staple the DMG ----
# We build the DMG ourselves (instead of letting Tauri do it) because Tauri's
# copy-helper is blocked from writing to /Volumes/Kimbo/Kimbo.app on this
# machine. create-dmg stages via `cp -R` into a `-mountrandom` image, which is
# not blocked, so we can use the volume name "Kimbo" directly.
#
# The installer window is designed art: a flat dark Catppuccin base with the
# Kimbo wordmark, both icons on light tiles (so Finder's dark label text stays
# legible), and a drag arrow — rendered to scripts/dmg/dmg-background.tiff by
# scripts/dmg/make-background.mjs. The window is 32pt taller than the 400pt
# background to account for the title bar so the art sits flush (see that
# script's header for the sizing rationale).
echo ""
echo -e "${CYAN}Bundling DMG (volname: Kimbo)...${NC}"

DMG_VOLNAME="Kimbo"
DMG_STAGE=$(mktemp -d -t kimbo-dmg-stage)
# Unstable already installed a combined trap (restore version files + remove
# DMG_STAGE) above; only (re)install the plain cleanup trap for stable so we
# don't clobber it.
if [[ "$CHANNEL" == "stable" ]]; then
  trap 'rm -rf "$DMG_STAGE"' EXIT
fi

cp -R "$APP_PATH" "$DMG_STAGE/"
mkdir -p "$DMG_DIR"
rm -f "$DMG_PATH"

VOLICON_PATH="src-tauri/icons/icon.icns"
VOLICON_ARGS=()
if [[ -f "$VOLICON_PATH" ]]; then
  VOLICON_ARGS=(--volicon "$VOLICON_PATH")
fi

DMG_BACKGROUND="scripts/dmg/dmg-background.tiff"
BACKGROUND_ARGS=()
if [[ -f "$DMG_BACKGROUND" ]]; then
  BACKGROUND_ARGS=(--background "$DMG_BACKGROUND")
fi

scripts/dmg/bundle_dmg.sh \
  --volname "$DMG_VOLNAME" \
  "${VOLICON_ARGS[@]}" \
  "${BACKGROUND_ARGS[@]}" \
  --icon-size 128 \
  --text-size 13 \
  --icon "Kimbo.app" 180 200 \
  --app-drop-link 480 200 \
  --window-size 660 432 \
  --hide-extension "Kimbo.app" \
  "$DMG_PATH" \
  "$DMG_STAGE"

if [[ ! -f "$DMG_PATH" ]]; then
  echo -e "${RED}DMG bundling failed${NC}"
  exit 1
fi

echo -e "  ${GREEN}Bundled:${NC} ${DMG_PATH}"

# Sign the DMG.
echo -e "${CYAN}Signing DMG...${NC}"
codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG_PATH"
echo -e "  ${GREEN}✓${NC} Signed"

# Notarize the DMG via notarytool.
echo -e "${CYAN}Submitting DMG for notarization...${NC}"
APPLE_API_KEY_P8="${APPLE_API_KEY_PATH:-${HOME}/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8}"
if [[ ! -f "$APPLE_API_KEY_P8" ]]; then
  echo -e "${RED}Notary key not found at ${APPLE_API_KEY_P8}${NC}"
  echo "Set APPLE_API_KEY_PATH or place AuthKey_${APPLE_API_KEY}.p8 under ~/.appstoreconnect/private_keys/"
  exit 1
fi
xcrun notarytool submit "$DMG_PATH" \
  --key "$APPLE_API_KEY_P8" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait
echo -e "  ${GREEN}✓${NC} Notarized"

# Staple the ticket to the DMG.
echo -e "${CYAN}Stapling DMG...${NC}"
xcrun stapler staple "$DMG_PATH"
echo -e "  ${GREEN}✓${NC} Stapled"

# Gatekeeper check on the stapled DMG.
SPCTL_DMG_OUT=$(spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH" 2>&1 || true)
if echo "$SPCTL_DMG_OUT" | grep -q "accepted"; then
  echo -e "  ${GREEN}✓${NC} Gatekeeper accepts DMG"
else
  echo -e "  ${YELLOW}⚠${NC} Gatekeeper did not accept DMG:"
  echo "$SPCTL_DMG_OUT" | sed 's/^/      /'
fi

# ---- Step 3: Run tests ----
echo ""
echo -e "${CYAN}Running tests...${NC}"
# Use the release test profile: vitest runs single-threaded
# (--no-file-parallelism) so a busy CPU — e.g. a concurrent build — can't
# starve the fork-worker pool into "Timeout waiting for worker to respond"
# and abort the release. Slower, but a release gate values reliability.
npm run test:release
echo -e "  ${GREEN}All tests passed${NC}"

# ---- Step 4: Commit, tag, push (stable only — unstable never touches git) ----
if [[ "$CHANNEL" == "stable" ]]; then
  echo ""
  echo -e "${CYAN}Committing and tagging...${NC}"

  git add -A
  git commit -m "release: v${NEW_VERSION}"
  git tag -a "$TAG" -m "Release ${TAG}"
  git push origin HEAD
  git push origin "$TAG"

  echo -e "  ${GREEN}Pushed${NC} ${TAG}"
fi

# ---- Step 5: Create GitHub release ----
if [[ "$CHANNEL" == "stable" ]]; then
  echo ""
  echo -e "${CYAN}Creating GitHub release...${NC}"

  NOTES=$(cat <<EOF
## Kimbo v${NEW_VERSION}

### Downloads

- **macOS (Apple Silicon):** \`Kimbo_${NEW_VERSION}_aarch64.dmg\`

### Changes

See [CHANGELOG.md](CHANGELOG.md) for details.
EOF
)

  # ---- Step 5a: Build the updater manifest (latest.json) ----
  # tauri-plugin-updater fetches this file from the endpoint configured in
  # tauri.conf.json. It needs: version, pub_date, notes, platforms.<target>.url
  # and platforms.<target>.signature (contents of Kimbo.app.tar.gz.sig).
  echo -e "${CYAN}Building updater manifest...${NC}"

  if [[ ! -f "$UPDATER_TARBALL" ]]; then
    echo -e "${RED}Updater tarball missing at ${UPDATER_TARBALL}.${NC}"
    echo "tauri-bundler should produce it when createUpdaterArtifacts is true."
    exit 1
  fi
  if [[ ! -f "$UPDATER_SIG" ]]; then
    echo -e "${RED}Updater signature missing at ${UPDATER_SIG}.${NC}"
    exit 1
  fi

  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  SIG_CONTENT=$(cat "$UPDATER_SIG")
  TARBALL_URL="https://github.com/lucatescari/kimbo-terminal/releases/download/${TAG}/Kimbo_${NEW_VERSION}_aarch64.app.tar.gz"

  LATEST_JSON="target/release/bundle/macos/latest.json"
  # jq keeps the JSON syntactically valid regardless of what's in NOTES / SIG_CONTENT.
  jq -n \
    --arg version "$NEW_VERSION" \
    --arg notes "See https://github.com/lucatescari/kimbo-terminal/releases/tag/${TAG}" \
    --arg pub_date "$PUB_DATE" \
    --arg sig "$SIG_CONTENT" \
    --arg url "$TARBALL_URL" \
    '{
      version: $version,
      notes: $notes,
      pub_date: $pub_date,
      platforms: {
        "darwin-aarch64": { signature: $sig, url: $url }
      }
    }' > "$LATEST_JSON"
  echo -e "  ${GREEN}Wrote:${NC} ${LATEST_JSON}"

  # The GitHub asset name must match the URL in latest.json, hence the rename.
  RENAMED_TARBALL="target/release/bundle/macos/Kimbo_${NEW_VERSION}_aarch64.app.tar.gz"
  cp "$UPDATER_TARBALL" "$RENAMED_TARBALL"

  gh release create "$TAG" \
    --title "Kimbo v${NEW_VERSION}" \
    --notes "$NOTES" \
    "$DMG_PATH" \
    "$RENAMED_TARBALL" \
    "$LATEST_JSON"

  echo ""
  echo -e "${GREEN}Release v${NEW_VERSION} published!${NC}"
  echo -e "View: ${CYAN}$(gh release view "$TAG" --json url -q .url)${NC}"
  echo ""
fi

# ---- Step 5 (unstable): overwrite the rolling "unstable" pre-release ----
if [[ "$CHANNEL" == "unstable" ]]; then
  echo -e "${CYAN}Publishing to the unstable channel...${NC}"
  # latest.json for the unstable manifest (same shape as stable).
  TARBALL_URL="https://github.com/lucatescari/kimbo-terminal/releases/download/unstable/Kimbo_${NEW_VERSION}_aarch64.app.tar.gz"
  jq -n --arg version "$NEW_VERSION" \
    --arg notes "Unstable preview build v${NEW_VERSION}" \
    --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg sig "$(cat "$UPDATER_SIG")" --arg url "$TARBALL_URL" \
    '{version:$version, notes:$notes, pub_date:$pub_date,
      platforms:{"darwin-aarch64":{signature:$sig, url:$url}}}' \
    > "target/release/bundle/macos/latest.json"
  RENAMED_TARBALL="target/release/bundle/macos/Kimbo_${NEW_VERSION}_aarch64.app.tar.gz"
  cp "$UPDATER_TARBALL" "$RENAMED_TARBALL"

  # Ensure the rolling pre-release exists, then overwrite its assets.
  if ! gh release view unstable >/dev/null 2>&1; then
    gh release create unstable --prerelease --title "Kimbo (unstable)" \
      --notes "Rolling preview channel. Assets are replaced on each unstable build."
  fi
  gh release edit unstable --title "Kimbo (unstable) — v${NEW_VERSION}" \
    --notes "Unstable preview build v${NEW_VERSION} ($(date -u +%Y-%m-%d))."
  gh release upload unstable \
    "$DMG_PATH" "$RENAMED_TARBALL" "target/release/bundle/macos/latest.json" --clobber

  echo -e "${GREEN}Unstable v${NEW_VERSION} published.${NC}"
  echo -e "View: ${CYAN}$(gh release view unstable --json url -q .url)${NC}"
  exit 0
fi
