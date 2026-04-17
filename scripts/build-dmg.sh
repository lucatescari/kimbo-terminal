#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:-0.1.0}"
APP_NAME="Kimbo"
BUNDLE_ID="com.kimbo.app"
SIGN_IDENTITY="${KIMBO_SIGN_IDENTITY:-44182A302783F4D0ACA0888C54E6CAFC89709828}"
NOTARY_PROFILE="${KIMBO_NOTARY_PROFILE:-kimbo-notary}"

echo "Building Kimbo v${VERSION}..."
cargo build --release

echo "Creating app bundle..."
APP_DIR="target/release/${APP_NAME}.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp target/release/kimbo "$APP_DIR/Contents/MacOS/"
cp AppIcon.icns "$APP_DIR/Contents/Resources/"

cat > "$APP_DIR/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>kimbo</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

if [ -n "$SIGN_IDENTITY" ]; then
  echo "Signing app bundle..."
  codesign --force --options runtime \
    --sign "$SIGN_IDENTITY" \
    "$APP_DIR/Contents/MacOS/kimbo"
  codesign --force --options runtime \
    --sign "$SIGN_IDENTITY" \
    "$APP_DIR"
fi

echo "Creating DMG..."
DMG_NAME="Kimbo-${VERSION}.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP_DIR" -ov -format UDZO "target/release/${DMG_NAME}"

if [ -n "$SIGN_IDENTITY" ]; then
  echo "Signing DMG..."
  codesign --force --sign "$SIGN_IDENTITY" "target/release/${DMG_NAME}"

  echo "Submitting for notarization..."
  xcrun notarytool submit "target/release/${DMG_NAME}" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait

  echo "Stapling notarization ticket..."
  xcrun stapler staple "target/release/${DMG_NAME}"
fi

echo "Built: target/release/${DMG_NAME}"
