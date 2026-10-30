#!/bin/bash
# Builds the macOS app and DMG on this Mac (Apple Silicon or Intel - whichever Mac runs it).
# Needs Python 3.10+. Optional signing: set MAC_SIGN_ID ("Developer ID Application: ...") and, for
# notarization, APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD.
set -euo pipefail
cd "$(dirname "$0")"
VER=$(cat VERSION)
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && TAG="apple-silicon" || TAG="intel"
python3 -m pip install --upgrade -r requirements.txt pyinstaller
python3 tools/build_page.py
rm -rf icon.iconset && mkdir icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon.png --out icon.iconset/icon_${s}x${s}.png >/dev/null
  d=$((s*2)); sips -z $d $d assets/icon.png --out icon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns icon.iconset -o assets/icon.icns && rm -rf icon.iconset
python3 -m PyInstaller --noconfirm --clean --windowed --name "Mo Stocks" --icon assets/icon.icns \
  --osx-bundle-identifier com.mhassoun.mostocks \
  --add-data "app/page.html:." --add-data "app/fonts:fonts" --add-data "assets/icon.png:." --add-data "VERSION:." app/main.py
if [ -n "${MAC_SIGN_ID:-}" ]; then
  codesign --deep --force --options runtime --timestamp --sign "$MAC_SIGN_ID" "dist/Mo Stocks.app"
fi
DMG="dist/MoStocks_v${VER}_mac_${TAG}.dmg"
rm -rf dmg && mkdir dmg && cp -R "dist/Mo Stocks.app" dmg/ && ln -s /Applications dmg/Applications
hdiutil create -volname "Mo Stocks" -srcfolder dmg -ov -format UDZO "$DMG"
rm -rf dmg
if [ -n "${MAC_SIGN_ID:-}" ] && [ -n "${APPLE_ID:-}" ]; then
  codesign --force --sign "$MAC_SIGN_ID" "$DMG"
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
  xcrun stapler staple "$DMG"
fi
echo "Done: $DMG"
