"""Copperleaf catalogue API (lab stand-in): serves the schema version and title count."""
import argparse
import http.server
import json
import pathlib

DATA = pathlib.Path("/data")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        version = (DATA / "schema_version").read_text().strip() if (DATA / "schema_version").exists() else "none"
        titles = sum(1 for _ in open(DATA / "titles.csv")) if (DATA / "titles.csv").exists() else 0
        body = json.dumps({"service": "catalogue-api", "schema": version, "titles": titles}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


parser = argparse.ArgumentParser(description="catalogue API server")
parser.add_argument("--port", type=int, default=8080)
args = parser.parse_args()
print(f"catalogue-api listening on :{args.port}", flush=True)
http.server.ThreadingHTTPServer(("", args.port), Handler).serve_forever()
