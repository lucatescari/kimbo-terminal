#!/usr/bin/env bash
# Regenerate every app-icon asset from src-ui/public/kimbo_normal.png.
#
# Outputs:
#   appicon/kimbo.png                         1024x1024 master (neutral bg)
#   src-tauri/icons/32x32.png
#   src-tauri/icons/128x128.png
#   src-tauri/icons/128x128@2x.png            (256x256)
#   src-tauri/icons/icon.icns
#   src-tauri/icons/icon.ico
#   AppIcon.icns                              copy of icon.icns (used by scripts/build-dmg.sh)

set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE="src-ui/public/kimbo_normal.png"
BG_COLOR="#EDEDEA"
CANVAS=1024
INSET_RATIO=0.80  # kimbo occupies 80% of the canvas's shorter edge

if [[ ! -f "$SOURCE" ]]; then
  echo "missing source: $SOURCE" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) not found; install with: brew install imagemagick" >&2
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "iconutil not found (macOS-only tool)" >&2
  exit 1
fi

TMP=$(mktemp -d -t kimbo-icons)
trap 'rm -rf "$TMP"' EXIT

INNER=$(awk -v c="$CANVAS" -v r="$INSET_RATIO" 'BEGIN { printf "%d", c*r }')
MASTER="appicon/kimbo.png"

mkdir -p appicon src-tauri/icons

echo "Compositing ${CANVAS}x${CANVAS} master onto ${BG_COLOR}..."
# Keep the alpha channel (all-opaque) so Tauri's icon macros accept it as RGBA.
magick "$SOURCE" \
  -resize "${INNER}x${INNER}" \
  -background "$BG_COLOR" \
  -gravity center \
  -extent "${CANVAS}x${CANVAS}" \
  -alpha on \
  -define png:color-type=6 \
  PNG32:"$MASTER"

echo "Generating Tauri PNGs..."
magick "$MASTER" -resize 32x32   -define png:color-type=6 PNG32:src-tauri/icons/32x32.png
magick "$MASTER" -resize 128x128 -define png:color-type=6 PNG32:src-tauri/icons/128x128.png
magick "$MASTER" -resize 256x256 -define png:color-type=6 PNG32:src-tauri/icons/128x128@2x.png

echo "Building macOS .icns (via iconutil)..."
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for spec in \
  "16    icon_16x16.png" \
  "32    icon_16x16@2x.png" \
  "32    icon_32x32.png" \
  "64    icon_32x32@2x.png" \
  "128   icon_128x128.png" \
  "256   icon_128x128@2x.png" \
  "256   icon_256x256.png" \
  "512   icon_256x256@2x.png" \
  "512   icon_512x512.png" \
  "1024  icon_512x512@2x.png"; do
  read -r size name <<<"$spec"
  magick "$MASTER" -resize "${size}x${size}" "$ICONSET/$name"
done
iconutil -c icns -o src-tauri/icons/icon.icns "$ICONSET"
cp src-tauri/icons/icon.icns AppIcon.icns

echo "Building Windows .ico..."
magick "$MASTER" \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 24x24 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) \
  -delete 0 \
  src-tauri/icons/icon.ico

echo "Done. Icons written:"
ls -lh "$MASTER" src-tauri/icons/*.png src-tauri/icons/icon.icns src-tauri/icons/icon.ico AppIcon.icns
