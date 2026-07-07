#!/bin/bash
# Linkflix launcher (Mac) — double-click me
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

( sleep 1 && open "http://localhost:4173/index.html" ) &
python3 "$APP_DIR/server.py"
