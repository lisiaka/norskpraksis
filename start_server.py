#!/usr/bin/env python3
"""
Start a local server for Norsk B2 Treningsverktøy.

The server does two things:
1. Serves the HTML app files from this directory.
2. Proxies Claude API calls via /proxy/claude so the browser
   never hits Anthropic directly (avoids CORS restrictions).

Usage:
    python3 start_server.py

Then open:  http://localhost:8080/norsk_b2_pro.html
"""

import http.server
import socketserver
import os
import webbrowser
import threading
import json
import urllib.request
import urllib.error

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
URL = f"http://localhost:{PORT}/norsk_b2_pro.html"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        pass  # suppress request logs

    def do_POST(self):
        if self.path == "/proxy/claude":
            self._proxy_claude()
        else:
            self.send_error(404, "Not found")

    def _proxy_claude(self):
        """Forward the request to Anthropic and return the response."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body)

            api_key = payload.pop("__api_key__", "")
            if not api_key:
                self._send_json(400, {"error": {"message": "No API key provided"}})
                return

            req = urllib.request.Request(
                ANTHROPIC_API_URL,
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
                method="POST",
            )

            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                self._send_raw(resp.status, data)

        except urllib.error.HTTPError as e:
            data = e.read()
            self._send_raw(e.code, data)
        except Exception as e:
            self._send_json(500, {"error": {"message": str(e)}})

    def _send_raw(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status, obj):
        self._send_raw(status, json.dumps(obj).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def open_browser():
    import time
    time.sleep(0.5)
    webbrowser.open(URL)


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print()
        print("  🇳🇴  Norsk B2 Treningsverktøy")
        print(f"  → Åpner:  {URL}")
        print()
        print("  Trykk Ctrl+C for å stoppe.")
        print()

        threading.Thread(target=open_browser, daemon=True).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Server stoppet.")
