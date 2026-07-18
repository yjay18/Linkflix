#!/bin/bash
# Fetch and bundle IINA for native MKV playback in Linkflix
set -e

cd "$(dirname "$0")/.."

echo "Fetching latest IINA release info..."
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/iina/iina/releases/latest | grep browser_download_url | cut -d '"' -f 4 | grep '.dmg$')

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Failed to find IINA DMG url!"
  exit 1
fi

echo "Downloading IINA from $DOWNLOAD_URL..."
TMP_DMG="build/IINA_download.dmg"
mkdir -p build
curl -L -o "$TMP_DMG" "$DOWNLOAD_URL"

echo "Mounting DMG..."
MOUNT_POINT=$(hdiutil attach "$TMP_DMG" -nobrowse -noverify -noautoopen | grep /Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
  echo "Failed to mount DMG!"
  rm "$TMP_DMG"
  exit 1
fi

echo "Copying IINA.app to build/iina/..."
rm -rf build/iina
mkdir -p build/iina
cp -R "$MOUNT_POINT/IINA.app" "build/iina/IINA.app"

echo "Unmounting DMG..."
hdiutil detach "$MOUNT_POINT" -quiet
rm "$TMP_DMG"

echo "IINA successfully bundled in build/iina/IINA.app ($(du -sh build/iina/IINA.app | cut -f1))"
