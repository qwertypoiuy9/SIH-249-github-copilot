"""Vercel catch-all API function for the existing HTTP handler."""

import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server

server.DB_PATH = Path("/tmp/airpower-demo.db")
server.initialize()


class handler(server.AppHandler):
    def _restore_original_route(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        route = query.pop("vercel_route", [None])[0]
        if route:
            original_query = urlencode(query, doseq=True)
            self.path = route + (f"?{original_query}" if original_query else "")

    def do_GET(self):
        self._restore_original_route()
        super().do_GET()

    def do_POST(self):
        self._restore_original_route()
        super().do_POST()

    def do_HEAD(self):
        self._restore_original_route()
        super().do_HEAD()

    def do_OPTIONS(self):
        self._restore_original_route()
        super().do_OPTIONS()

    def do_PUT(self):
        self._restore_original_route()
        super().do_PUT()

    def do_DELETE(self):
        self._restore_original_route()
        super().do_DELETE()
