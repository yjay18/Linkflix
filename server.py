#!/usr/bin/env python3
"""Local Linkflix server.

Serves the static app and accepts same-origin autosaves for library/library.json.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile


ROOT = Path(__file__).resolve().parent
LIBRARY_DIR = ROOT / "library"
PORT = int(os.environ.get("LINKFLIX_PORT", "4173"))


class LinkflixHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/save-library":
            self.send_error(404, "Not found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            library = payload.get("library")
            if not isinstance(library, list):
                raise ValueError("Expected a library array")

            LIBRARY_DIR.mkdir(exist_ok=True)
            target = LIBRARY_DIR / "library.json"
            data = json.dumps({"library": library}, indent=2, ensure_ascii=False)
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=str(LIBRARY_DIR),
                prefix=".library.",
                suffix=".tmp",
                delete=False,
            ) as tmp:
                tmp.write(data)
                tmp.write("\n")
                tmp_name = tmp.name
            os.replace(tmp_name, target)

            body = json.dumps({"ok": True, "path": str(target.relative_to(ROOT))}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self.send_response(400)
            body = json.dumps({"ok": False, "error": str(exc)}).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    os.chdir(ROOT)
    print(f"Linkflix running at http://localhost:{PORT}/index.html")
    print("Autosaves library changes to library/library.json")
    ThreadingHTTPServer(("localhost", PORT), LinkflixHandler).serve_forever()
