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

# Get current version from package.json
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

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

# tauri-plugin-updater: sign the updater tarball with a Tauri-managed keypair.
# TAURI_SIGNING_PRIVATE_KEY can be either the raw key contents (string) or a
# path to the .key file — tauri-bundler accepts both. TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# unlocks it. Both must be present or tauri-bundler errors out at the updater step.
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
  echo "Export it (or prefix the release command) with the password you set when generating the key."
  exit 1
fi

# Build only the .app bundle. We skip Tauri's DMG step because macOS System
# Policy (syspolicyd) denies copy-helper from writing to /Volumes/Kimbo/Kimbo.app
# on this machine — a persistent ExecPolicy record from a prior run. We build
# the DMG ourselves below with a different volume name to sidestep the block.
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
# We do this ourselves (instead of letting Tauri do it) because the sandbox
# rejects writes to /Volumes/Kimbo/Kimbo.app on this machine. We mount at
# /Volumes/Kimbo Terminal/ instead, which is not blocked.
echo ""
echo -e "${CYAN}Bundling DMG (volname: Kimbo Terminal)...${NC}"

DMG_VOLNAME="Kimbo Terminal"
DMG_STAGE=$(mktemp -d -t kimbo-dmg-stage)
trap 'rm -rf "$DMG_STAGE"' EXIT

cp -R "$APP_PATH" "$DMG_STAGE/"
mkdir -p "$DMG_DIR"
rm -f "$DMG_PATH"

VOLICON_PATH="src-tauri/icons/icon.icns"
VOLICON_ARGS=()
if [[ -f "$VOLICON_PATH" ]]; then
  VOLICON_ARGS=(--volicon "$VOLICON_PATH")
fi

scripts/dmg/bundle_dmg.sh \
  --volname "$DMG_VOLNAME" \
  "${VOLICON_ARGS[@]}" \
  --icon "Kimbo.app" 180 170 \
  --app-drop-link 480 170 \
  --window-size 660 400 \
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
npm run test:all
echo -e "  ${GREEN}All tests passed${NC}"

# ---- Step 4: Commit, tag, push ----
echo ""
echo -e "${CYAN}Committing and tagging...${NC}"

git add -A
git commit -m "release: v${NEW_VERSION}"
git tag -a "$TAG" -m "Release ${TAG}"
git push origin HEAD
git push origin "$TAG"

echo -e "  ${GREEN}Pushed${NC} ${TAG}"

# ---- Step 5: Create GitHub release ----
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
