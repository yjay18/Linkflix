#!/usr/bin/env python3
"""Local Linkflix server.

Serves the static app and accepts same-origin autosaves for library/library.json.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import urllib.request


ROOT = Path(__file__).resolve().parent
LIBRARY_DIR = ROOT / "library"
PORT = int(os.environ.get("LINKFLIX_PORT", "4173"))
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")


class LinkflixServer(ThreadingHTTPServer):
    allow_reuse_address = True


class LinkflixIPv6Server(LinkflixServer):
    address_family = socket.AF_INET6


class LinkflixHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/models":
            try:
                with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=5) as r:
                    data = json.load(r)
                self._json(200, {"models": [m["name"] for m in data.get("models", [])]})
            except Exception as exc:
                self._json(502, {"models": [], "error": f"Ollama not reachable: {exc}"})
            return
        super().do_GET()

    def handle_concierge(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json(400, {"error": "bad JSON"})
            return
        upstream_body = json.dumps({
            "model": payload.get("model") or "llama3.2",
            "messages": payload.get("messages") or [],
            "stream": True,
            "options": {"temperature": payload.get("temperature", 0.4)},
        }).encode()
        req = urllib.request.Request(
            OLLAMA + "/api/chat", data=upstream_body,
            headers={"Content-Type": "application/json"})
        try:
            upstream = urllib.request.urlopen(req, timeout=300)
        except Exception as exc:
            self._json(502, {"error": f"Ollama not reachable at {OLLAMA}: {exc}"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        try:
            for line in upstream:                 # Ollama streams one JSON object per line
                self.wfile.write(line)
                self.wfile.flush()
        except Exception:
            pass

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/concierge":
            self.handle_concierge()
            return
        if path != "/api/save-library":
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
    servers = []
    for host, server_class in (("127.0.0.1", LinkflixServer), ("::1", LinkflixIPv6Server)):
        try:
            servers.append(server_class((host, PORT), LinkflixHandler))
        except OSError as exc:
            print(f"Could not listen on {host}:{PORT}: {exc}")

    if not servers:
        raise SystemExit(
            f"Could not start Linkflix on port {PORT}. "
            "Close the old server window or set LINKFLIX_PORT to another port."
        )

    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()

    servers[0].serve_forever()
