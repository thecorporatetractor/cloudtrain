#!/usr/bin/env python3
"""Copperleaf catalogue migrations (lab stand-in). Exit code = legacy rows skipped."""
import argparse
import pathlib
import socket
import sys

parser = argparse.ArgumentParser(description="apply a catalogue schema migration")
parser.add_argument("--apply", required=True, metavar="ID", help="migration id, e.g. 0042")
parser.add_argument("--data", default="/data", help="database directory (default /data)")
args = parser.parse_args()

data = pathlib.Path(args.data)
version_file = data / "schema_version"
if not version_file.exists():
    print(f"no catalogue database in {data}: nothing to migrate", flush=True)
    sys.exit(0)
current = version_file.read_text().strip()
if current >= args.apply:
    print(f"schema already at {current}; {args.apply} not applied", flush=True)
    sys.exit(0)
rows = (data / "titles.csv").read_text().splitlines() if (data / "titles.csv").exists() else []
skipped = sum(1 for r in rows if r.endswith(";;"))
version_file.write_text(args.apply + "\n")
with open(data / "migrations.log", "a") as log:
    log.write(f"{args.apply} applied host={socket.gethostname()} skipped={skipped}\n")
print(f"migration {args.apply} applied: {len(rows) - skipped} rows migrated, {skipped} legacy rows skipped", flush=True)
sys.exit(skipped)
