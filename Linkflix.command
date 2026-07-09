#!/bin/bash
# Linkflix launcher (Mac) — double-click me
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

URL="http://localhost:4173/index.html"

python3 "$APP_DIR/server.py" &
SERVER_PID=$!

for _ in {1..60}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL"
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Linkflix server stopped before it was ready."
    wait "$SERVER_PID"
    exit 1
  fi
  sleep 0.25
done

echo "Linkflix did not become ready at $URL."
echo "If another Linkflix window is already open, close its server window and try again."
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
exit 1
