# KQL engine spike: SOC-analyst queries + probes, run inside the kql-ws image:
#   docker run --rm -v $PWD/tools/images/kql-ws/spike:/spike cloudtrain/kql-ws:1 python3 /spike/run.py
# Writes /spike/out (data, raw output, results.json). Results of the patched build: results.json.
import json, os, re, subprocess, sys
sys.path.insert(0, "/spike")
from spike_queries import Q
from probes import P
OUT = "/spike/out"; os.makedirs(OUT + "/res", exist_ok=True)
subprocess.run(["ct-loggen", "generate", "--seed", "lab-42", "--end", "2026-10-18T12:00:00Z",
                "--out", OUT + "/ds1", "--answers", OUT + "/ans.json"], check=True)
A = json.load(open(OUT + "/ans.json"))
load = subprocess.run(["kql-load", OUT + "/ds1"], capture_output=True, text=True, check=True).stdout
load += subprocess.run(["kql-load", "/opt/cloudtrain/kql/datasets/sentinel-sample", "--prefix", "Sample_"],
                       capture_output=True, text=True, check=True).stdout
items = [(q[0], q[1], q[2], q[3], "spike") for q in Q] + [(p[0], p[1], p[2], p[3], "probe") for p in P]
s = ".set table.maxrows 0\n\n" + load + ".loadgeoip\n\n"
for i, f, k, _, _ in items:
    s += f".echo BEGIN_{i}\n\n{k}\n\n.save {OUT}/res/{i}.json\n\n.echo END_{i}\n\n"
open(OUT + "/all.lokql", "w").write(s)
r = subprocess.run(["/opt/cloudtrain/kql/lokql/lokql", "run", "-f", OUT + "/all.lokql"], capture_output=True, text=True)
o = r.stdout + r.stderr; open(OUT + "/all.out", "w").write(o)
res = []
for i, feat, kql, check, kind in items:
    m = re.search(rf"BEGIN_{i}\n(.*?)END_{i}", o, re.S); seg = m.group(1) if m else ""
    f = f"{OUT}/res/{i}.json"
    if not os.path.exists(f):
        lines = [l for l in seg.splitlines() if l.strip() and not l.startswith(("┌", "│", "└", "├", "Query error", "---", "Not saving"))]
        st, d = "unsupported", " | ".join(lines)[:250]
    else:
        rows = json.load(open(f))
        if kind == "spike":
            try: c = check(rows, A)
            except Exception as e: c = f"check raised {e!r}"
            st, d = ("works", "") if c is True else ("wrong", str(c)[:250])
        else:
            body = json.dumps(rows, separators=(",", ":")).replace(" ", "")
            st, d = ("works", "") if (check is None or check in body) else ("wrong", body[:250])
    res.append({"id": i, "feature": feat, "status": st, "detail": d})
    print(f"{i}\t{st}\t{feat}\t{d}")
json.dump(res, open(OUT + "/results.json", "w"), indent=1)
