"""Local static preview with an exact, cached parameterized coverage API."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from coverage import ALTITUDES_KM, search


@lru_cache(maxsize=256)
def solve(altitude: int, inclination: int, elevation: int) -> dict:
    return search(altitude, inclination, elevation)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        if urlsplit(self.path).path != '/api/solve':
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path != '/api/solve':
            return super().do_GET()
        try:
            args = parse_qs(parsed.query)
            altitude = int(args['alt'][0])
            inclination = int(args['inc'][0])
            elevation = int(args['elev'][0])
            if altitude not in ALTITUDES_KM or not 30 <= inclination <= 90 or not 0 <= elevation <= 30:
                raise ValueError('parameter outside supported range')
            result = solve(altitude, inclination, elevation)
            payload = json.dumps(result, separators=(',', ':')).encode()
            self.send_response(200)
        except (KeyError, IndexError, ValueError) as exc:
            payload = json.dumps({'error': str(exc)}).encode()
            self.send_response(400)
        except Exception as exc:
            payload = json.dumps({'error': str(exc)}).encode()
            self.send_response(500)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    os.chdir(os.path.dirname(__file__))
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    print('Constellation preview at http://127.0.0.1:8765/', flush=True)
    server.serve_forever()
