#!/usr/bin/env bash
# Vendors the subset of VS Code Pets (MIT) sprites Kimbo ships.
# Source: https://github.com/tonybaloney/vscode-pets (media/, media/extra.zip)
set -euo pipefail

RAW="https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/media"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-ui/public/pets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DEST"

# species|colors|tokens   (cat handled separately from extra.zip)
SPECS=(
  "dog|akita black brown red white|idle walk walk_fast run swipe with_ball lie"
  "snake|green|idle walk walk_fast run swipe with_ball"
  "crab|red|idle walk walk_fast run swipe with_ball"
  "chicken|brown white|idle walk walk_fast run swipe with_ball"
  "turtle|green orange|idle walk walk_fast run swipe with_ball lie"
  "fox|red white|idle walk walk_fast run swipe with_ball lie"
  "snail|brown|idle walk walk_fast run swipe with_ball"
  "panda|black brown|idle walk walk_fast run swipe with_ball lie"
  "cockatiel|brown gray|idle walk walk_fast run swipe with_ball"
)

dl() { # url dest -- skip if 404 (e.g. species without a given token)
  if curl -fsSL "$1" -o "$2"; then echo "  ok  $(basename "$2")"; else echo "  skip $(basename "$2")"; fi
}

for row in "${SPECS[@]}"; do
  IFS='|' read -r sp colors tokens <<< "$row"
  mkdir -p "$DEST/$sp"
  for c in $colors; do
    for t in $tokens; do dl "$RAW/$sp/${c}_${t}_8fps.gif" "$DEST/$sp/${c}_${t}_8fps.gif"; done
  done
  # icons + license (best-effort; not every species ships every icon)
  dl "$RAW/$sp/icon.png" "$DEST/$sp/icon.png"
  for c in $colors; do dl "$RAW/$sp/icon_${c}.png" "$DEST/$sp/icon_${c}.png"; done
  dl "$RAW/$sp/license.txt" "$DEST/$sp/license.txt"
done

# Cat: extra.zip on raw.githubusercontent.com is password-encrypted; extract from
# the published VSIX release instead (which is a plain zip containing all media).
VSIX_URL="https://github.com/tonybaloney/vscode-pets/releases/download/1.35.0/vscode-pets-1.35.0.vsix"
mkdir -p "$DEST/cat"
curl -fsSL "$VSIX_URL" -o "$TMP/vscode-pets.vsix"
( cd "$TMP" && unzip -oq vscode-pets.vsix 'extension/media/cat/*' )
cp "$TMP"/extension/media/cat/*.gif "$DEST/cat/" 2>/dev/null || true
cp "$TMP"/extension/media/cat/icon*.png "$DEST/cat/" 2>/dev/null || true

# Top-level license
curl -fsSL "https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/LICENSE" -o "$DEST/VSCODE-PETS-LICENSE"

echo "Done. Vendored into $DEST"
