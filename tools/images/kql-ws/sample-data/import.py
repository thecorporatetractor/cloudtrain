#!/usr/bin/env python3
"""Normalise Azure-Sentinel sample CSV exports into a kql-ws dataset (JSONL + schema.json).

  import.py SRC_DIR OUT_DIR [sources.lock]

SRC_DIR holds the files named in sources.lock (paths relative to "Sample Data/"). Each
file's sha256 is checked. Exported headers such as "TimeGenerated [UTC]" lose the suffix,
Kusto's export datetime format ("10/4/2022, 7:16:04.683 PM") becomes ISO 8601, files for
the same table are unioned (missing columns are null), and "max rows" keeps the first N.
Columns empty in every row are dropped. Columns are strings except TimeGenerated (datetime) and the numeric ones in NUMERIC.
"""
import csv
import datetime as dt
import hashlib
import json
import os
import sys

NUMERIC = {"SourcePort": "int", "DestinationPort": "int", "EventCount": "int", "SentBytes": "long",
           "ReceivedBytes": "long", "EventID": "int", "ProcessID": "int", "Task": "int", "EventLevel": "int",
           "LogSeverity": None}  # LogSeverity is a string in Sentinel
DATETIME = {"TimeGenerated", "EventTime", "ReceiptTime_dt"}
csv.field_size_limit(1 << 26)


def to_iso(v: str):
    v = v.strip()
    if not v or v == "null":
        return None
    for fmt in ("%m/%d/%Y, %I:%M:%S.%f %p", "%m/%d/%Y, %I:%M:%S %p"):
        try:
            return dt.datetime.strptime(v, fmt).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        except ValueError:
            pass
    return v  # already ISO (2020-10-09T02:32:01.657Z)


def convert(v, kind):
    if v is None or v == "" or v == "null":
        return None
    if kind == "datetime":
        return to_iso(v)
    if kind in ("int", "long"):
        try:
            return int(float(v))
        except ValueError:
            return None
    return v


def main():
    src, out = sys.argv[1], sys.argv[2]
    lock = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), "sources.lock")
    tables = {}
    for line in open(lock, encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        table, maxrows, sha, path = line.rstrip("\n").split(" ", 3)
        fpath = os.path.join(src, path)
        got = hashlib.sha256(open(fpath, "rb").read()).hexdigest()
        if got != sha:
            sys.exit(f"sha256 mismatch for {path}: {got}")
        with open(fpath, encoding="utf-8-sig", newline="") as f:
            r = csv.reader(f)
            header = [h.replace(" [UTC]", "").strip() for h in next(r)]
            t = tables.setdefault(table, {"columns": [], "rows": []})
            for h in header:
                if h and h not in t["columns"]:
                    t["columns"].append(h)
            for i, row in enumerate(r):
                if int(maxrows) and i >= int(maxrows):
                    break
                t["rows"].append({h: v for h, v in zip(header, row) if h})
    os.makedirs(out, exist_ok=True)
    schema = {"tables": {}}
    for name, t in tables.items():
        # drop columns that are empty in every row (exports carry the whole table schema)
        t["columns"] = [c for c in t["columns"] if any(row.get(c) not in (None, "", "null") for row in t["rows"])]
        kinds = {c: "datetime" if c in DATETIME else (NUMERIC.get(c) or "string") for c in t["columns"]}
        with open(os.path.join(out, f"{name}.jsonl"), "w", encoding="utf-8") as f:
            for row in t["rows"]:
                f.write(json.dumps({c: convert(row.get(c), kinds[c]) for c in t["columns"]}, separators=(",", ":")) + "\n")
        schema["tables"][name] = {"file": f"{name}.jsonl", "rows": len(t["rows"]),
                                  "columns": [{"name": c, "type": kinds[c]} for c in t["columns"]]}
        print(f"{name}: {len(t['rows'])} rows, {len(t['columns'])} columns", file=sys.stderr)
    with open(os.path.join(out, "schema.json"), "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=1)
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "Azure/Azure-Sentinel Sample Data @ 4aee8b861e8f0542a3fe525757762a7487ba1b3b (MIT)",
                   "tables": {k: v["rows"] for k, v in schema["tables"].items()}}, f, indent=1)


if __name__ == "__main__":
    main()
