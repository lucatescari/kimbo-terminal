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
echo -e "  ${GREEN}1)${NC} Patch  → v${MAJOR}.${MINOR}.$((PATCH + 1))  (bug fixes)"
echo -e "  ${GREEN}2)${NC} Minor  → v${MAJOR}.$((MINOR + 1)).0  (new features)"
echo -e "  ${GREEN}3)${NC} Major  → v$((MAJOR + 1)).0.0  (breaking changes)"
echo ""
read -p "Choose [1/2/3]: " CHOICE

case $CHOICE in
  1) PATCH=$((PATCH + 1)) ;;
  2) MINOR=$((MINOR + 1)); PATCH=0 ;;
  3) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"

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
export APPLE_SIGNING_IDENTITY="FC8F0EECBDED7E44715671B0E9B725048A92C141"

# Notarization — Tauri expects these specific env var names:
#   APPLE_API_KEY = the key ID (not the file path!)
#   APPLE_API_ISSUER = the issuer UUID
#   APPLE_API_KEY_PATH = path to .p8 file (auto-discovered from ~/.appstoreconnect/)
export APPLE_API_KEY="${APPLE_API_KEY_ID:-TST7M4RJDJ}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-277572be-01f6-4e99-9a67-336fc6fdc28e}"

npm run build

DMG_PATH="target/release/bundle/dmg/Kimbo_${NEW_VERSION}_aarch64.dmg"
APP_PATH="target/release/bundle/macos/Kimbo.app"

if [[ ! -f "$DMG_PATH" ]]; then
  echo -e "${RED}DMG not found at ${DMG_PATH}${NC}"
  echo "Build may have failed. Check output above."
  exit 1
fi

echo -e "  ${GREEN}Built:${NC} ${DMG_PATH}"

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

gh release create "$TAG" \
  --title "Kimbo v${NEW_VERSION}" \
  --notes "$NOTES" \
  "$DMG_PATH"

echo ""
echo -e "${GREEN}Release v${NEW_VERSION} published!${NC}"
echo -e "View: ${CYAN}$(gh release view "$TAG" --json url -q .url)${NC}"
echo ""
