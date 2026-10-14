#!/usr/bin/env python3
"""setstatus.py <repo> <lab-id> <status> [note]  - edit one lab's status (and notes) line in content/curriculum.yaml."""
import json, sys
root, lab, status = sys.argv[1:4]
note = sys.argv[4] if len(sys.argv) > 4 else None
f = f"{root}/content/curriculum.yaml"
lines = open(f).read().split("\n")
start = lines.index(f"  - id: {lab}")
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("  - id: ") or not lines[i].startswith("    "))
blk = lines[start:end]
si = next(i for i, l in enumerate(blk) if l.startswith("    status: "))
blk[si] = f"    status: {status}"
if note:
    ni = next((i for i, l in enumerate(blk) if l.startswith("    notes: ")), None)
    if ni is None:
        oi = next(i for i, l in enumerate(blk) if l.startswith("    owner: "))
        blk.insert(oi + 1, "    notes: " + json.dumps(note))
    else:
        old = blk[ni][len("    notes: "):]
        old = json.loads(old) if old.startswith('"') else old
        blk[ni] = "    notes: " + json.dumps(f"{old}; {note}")
lines[start:end] = blk
open(f, "w").write("\n".join(lines))
