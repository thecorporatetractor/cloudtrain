"""ct-loggen command line.

  ct-loggen generate --seed SEED --out DIR [--scenario NAME|none] [--end ISO] [--days N]
                     [--users N] [--scale F] [--format jsonl|csv] [--answers FILE]
  ct-loggen answers  --seed SEED [same world options]      the scenario's answers as JSON
  ct-loggen list                                           scenarios

The same seed and options always give byte-identical data and answers. The seed is never
written into DIR (learners can read DIR; whoever knows the seed can rebuild the answers),
so keep it in the lab's params and pass --answers a root-only path.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

from . import __version__
from .baseline import baseline
from .scenarios import SCENARIOS
from .tables import Dataset, iso
from .world import build_world


def build(seed: str, scenario: str, end: dt.datetime, days: int, users: int, scale: float):
    world = build_world(seed, users)
    start = (end - dt.timedelta(days=days)).replace(minute=0, second=0, microsecond=0)
    ds = Dataset()
    baseline(ds, world, start, end, scale)
    answers = {}
    if scenario != "none":
        answers = SCENARIOS[scenario].generate(ds, world, start, end)
    # nothing after `end`: labs query "the last N days" against a fixed window
    for name, rows in ds.rows.items():
        ds.rows[name] = [r for r in rows if "TimeGenerated" not in r or r["TimeGenerated"] <= end]
    answers.update({"company": world.company, "domain": world.domain, "start": iso(start), "end": iso(end)})
    return world, ds, answers


def parse_end(s: str | None) -> dt.datetime:
    if not s:
        now = dt.datetime.now(dt.timezone.utc)
        return now.replace(minute=0, second=0, microsecond=0)
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ct-loggen", description="Seeded Sentinel-shaped synthetic logs")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("generate", "answers"):
        s = sub.add_parser(name)
        s.add_argument("--seed", required=True, help="lab seed (keep it out of learner-readable files)")
        s.add_argument("--scenario", default="identity-compromise", choices=[*SCENARIOS, "none"])
        s.add_argument("--end", help="end of the data window, ISO 8601 UTC (default: the current hour)")
        s.add_argument("--days", type=int, default=7)
        s.add_argument("--users", type=int, default=60)
        s.add_argument("--scale", type=float, default=1.0, help="row volume multiplier for the noise")
        if name == "generate":
            s.add_argument("--out", required=True)
            s.add_argument("--format", choices=["jsonl", "csv"], default="jsonl")
            s.add_argument("--answers", help="write the answers here (mode 0600)")
    sub.add_parser("list")
    a = p.parse_args(argv)
    if a.cmd == "list":
        for n, m in SCENARIOS.items():
            print(f"{n}\t{m.DESCRIPTION}")
        return 0
    if a.days < 1 or a.users < 8 or a.scale <= 0:
        p.error("--days >= 1, --users >= 8, --scale > 0")
    end = parse_end(a.end)
    _, ds, answers = build(a.seed, a.scenario, end, a.days, a.users, a.scale)
    if a.cmd == "answers":
        json.dump(answers, sys.stdout, indent=1, sort_keys=True)
        print()
        return 0
    doc = ds.write(a.out, a.format)
    manifest = {"generator": f"ct-loggen {__version__}", "scenario": a.scenario, "start": answers["start"],
                "end": answers["end"], "company": answers["company"], "domain": answers["domain"],
                "tables": {k: v["rows"] for k, v in doc["tables"].items()}}
    with open(os.path.join(a.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    if a.answers:
        fd = os.open(a.answers, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(answers, f, indent=1, sort_keys=True)
    total = sum(manifest["tables"].values())
    print(f"ct-loggen: {total} rows in {len(manifest['tables'])} tables -> {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
