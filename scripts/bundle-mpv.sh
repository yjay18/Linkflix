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
echo "Portable mpv ready in build/mpv/ ($(du -sh build/mpv | cut -f1))"
