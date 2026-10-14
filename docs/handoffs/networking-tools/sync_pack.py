#!/usr/bin/env python3
"""Regenerate courses/paths of content/packs/networking/pack.yaml from the curriculum (existing labs only)."""
import os, sys, yaml
root = sys.argv[1]
cur = yaml.safe_load(open(f"{root}/content/curriculum.yaml"))
labs_dir = f"{root}/content/packs/networking/labs"
have = set(os.listdir(labs_dir))
courses, paths = [], []
for p in cur["paths"]:
    if p["domain"] != "networking":
        continue
    cids = []
    for m in p["modules"]:
        ls = [l for l in m["labs"] if l in have]
        if ls:
            courses.append({"id": m["id"], "title": m["title"], "description": f"{p['title']}: {m['title'].lower()}.", "level": p["level"], "labs": ls})
            cids.append(m["id"])
    if cids:
        paths.append({"id": p["id"], "title": p["title"], "framework": p["frameworks"][0], "courses": cids})
for x in cur["exams"]:
    if x["domain"] != "networking":
        continue
    pool = [l for b in x["blueprint"] for l in b["pool"] if l in have]
    if pool:
        courses.append({"id": f"{x['id']}-tasks", "title": "Practical exam simulation tasks", "description": "Task pool of the associate network engineer exam simulation (no hints, graded on end state).", "level": "intermediate", "labs": pool})
f = f"{root}/content/packs/networking/pack.yaml"
text = open(f).read()
head = text[: text.index("courses:")]
out = head + yaml.safe_dump({"courses": courses}, sort_keys=False, width=120) + "\n" + yaml.safe_dump({"paths": paths}, sort_keys=False, width=120)
open(f, "w").write(out)
