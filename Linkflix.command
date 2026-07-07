#!/bin/bash
# Linkflix launcher (Mac) — double-click me
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

( sleep 1 && open "http://127.0.0.1:4173/index.html" ) &
python3 -m http.server 4173 --bind 127.0.0.1 --directory "$APP_DIR"
