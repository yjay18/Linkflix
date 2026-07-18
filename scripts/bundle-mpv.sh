#!/bin/bash
# Build a self-contained portable mpv into build/mpv/ for bundling into Linkflix.app.
# Run once before `npm run dist`. Needs Homebrew.
set -e
cd "$(dirname "$0")/.."
command -v mpv >/dev/null 2>&1 || brew install mpv
command -v dylibbundler >/dev/null 2>&1 || brew install dylibbundler
rm -rf build/mpv; mkdir -p build/mpv
cp "$(command -v mpv)" build/mpv/mpv
chmod +w build/mpv/mpv
dylibbundler -od -b -x build/mpv/mpv -d build/mpv/lib/ -p @executable_path/lib/
install_name_tool -delete_rpath '@executable_path/lib/' build/mpv/mpv 2>/dev/null || true
codesign --force --sign - build/mpv/mpv

# ── Premium UI: uosc + thumbfast + Linkflix config ──────────────────
echo "Downloading uosc (modern UI)…"
UOSC_VER="5.12.0"
UOSC_URL="https://github.com/tomasklaen/uosc/releases/download/${UOSC_VER}/uosc.zip"
mkdir -p build/mpv/portable_config/scripts
curl -fsSL -o /tmp/uosc.zip "$UOSC_URL"
unzip -o /tmp/uosc.zip -d build/mpv/portable_config/scripts/
# Fix nested structure from the zip
if [ -d "build/mpv/portable_config/scripts/scripts/uosc" ]; then
  mv build/mpv/portable_config/scripts/scripts/uosc build/mpv/portable_config/scripts/uosc
  rmdir build/mpv/portable_config/scripts/scripts 2>/dev/null || true
fi
if [ -d "build/mpv/portable_config/scripts/fonts" ]; then
  mv build/mpv/portable_config/scripts/fonts build/mpv/portable_config/fonts
fi
rm /tmp/uosc.zip

echo "Downloading thumbfast (seekbar thumbnails)…"
curl -fsSL -o build/mpv/portable_config/scripts/thumbfast.lua \
  https://raw.githubusercontent.com/po5/thumbfast/master/thumbfast.lua

echo "Portable mpv ready in build/mpv/ ($(du -sh build/mpv | cut -f1))"
echo "  UI:     uosc ${UOSC_VER}"
echo "  Thumbs: thumbfast (latest)"
echo "  Config: portable_config/{mpv.conf, input.conf, script-opts/}"
