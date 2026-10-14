"""Deterministic fictional sample data for tier-A Linux labs: logs, CSV, text, configs."""
import os
import random
import sys

root = sys.argv[1]
rnd = random.Random(20261014)
stations = ["Ashford Vale", "Bramblecross", "Copperlee", "Dunmere", "Elderholt", "Fenwick Halt",
            "Greywater", "Hollin Bridge", "Ivymoor", "Juniper Quay", "Kestrel Point", "Larkspur"]
crews = ["amira.okafor", "ben.halloran", "chen.wei", "dana.sokolova", "eli.marsh", "farah.nadim",
         "gus.lindqvist", "hana.ito", "ivo.petrov", "jun.park"]
for d in ("logs", "csv", "text", "configs", "projects/delayboard/src"):
    os.makedirs(os.path.join(root, d), exist_ok=True)

with open(os.path.join(root, "csv", "ticket-sales.csv"), "w") as f:
    f.write("date,station,line,tickets,revenue_eur\n")
    for day in range(1, 31):
        for s in stations:
            t = rnd.randint(40, 900)
            f.write(f"2026-09-{day:02d},{s},L{rnd.randint(1, 5)},{t},{t * rnd.uniform(2.1, 7.9):.2f}\n")
with open(os.path.join(root, "csv", "crew-roster.csv"), "w") as f:
    f.write("id,name,role,home_station,shift\n")
    for i, c in enumerate(crews, 1):
        f.write(f"{i},{c},{rnd.choice(['driver', 'guard', 'dispatcher', 'engineer'])},{rnd.choice(stations)},{rnd.choice(['early', 'late', 'night'])}\n")

levels = ["INFO"] * 12 + ["WARN"] * 3 + ["ERROR"]
msgs = ["train {t} departed {s}", "train {t} delayed {m} min at {s}", "signal fault cleared at {s}",
        "platform change for train {t} at {s}", "ticket gate {g} offline at {s}", "crew {c} signed on at {s}"]
with open(os.path.join(root, "logs", "dispatch.log"), "w") as f:
    for i in range(5000):
        h, m, sec = divmod(i * 17, 3600)[0] % 24, (i * 17 // 60) % 60, (i * 17) % 60
        msg = rnd.choice(msgs).format(t=rnd.randint(100, 999), s=rnd.choice(stations), m=rnd.randint(1, 45),
                                      g=rnd.randint(1, 12), c=rnd.choice(crews))
        f.write(f"2026-09-14T{h:02d}:{m:02d}:{sec:02d}Z {rnd.choice(levels)} dispatch[{rnd.randint(1000, 1100)}]: {msg}\n")
with open(os.path.join(root, "logs", "access.log"), "w") as f:
    paths = ["/", "/timetable", "/delays", "/api/v1/trains", "/api/v1/stations", "/login", "/static/app.js"]
    for i in range(4000):
        ip = f"10.{rnd.randint(0, 3)}.{rnd.randint(0, 255)}.{rnd.randint(1, 254)}"
        code = rnd.choice([200] * 20 + [301, 304, 404, 404, 500])
        f.write(f'{ip} - - [14/Sep/2026:{(i // 180) % 24:02d}:{(i // 3) % 60:02d}:{i % 60:02d} +0000] '
                f'"GET {rnd.choice(paths)} HTTP/1.1" {code} {rnd.randint(200, 50000)} "-" "railctl/{rnd.randint(1, 4)}.0"\n')

with open(os.path.join(root, "text", "timetable-notes.txt"), "w") as f:
    for s in stations:
        f.write(f"{s}: first service {rnd.randint(5, 6)}:{rnd.choice(['05', '20', '35', '50'])}, "
                f"last service {rnd.randint(22, 23)}:{rnd.choice(['10', '25', '40', '55'])}. "
                f"Contact {rnd.choice(crews)}@example.invalid for changes.\n")
with open(os.path.join(root, "configs", "delayboard.conf"), "w") as f:
    f.write("# delayboard service configuration\n[server]\nlisten = 0.0.0.0\nport = 8080\n#port = 8443\n"
            "workers = 4\n\n[feed]\nurl = http://feed.railnet.example.invalid/v2\ninterval = 30\n"
            "retries = 3\n\n[log]\nlevel = info\npath = /var/log/delayboard/delayboard.log\n")
with open(os.path.join(root, "projects/delayboard/src", "board.py"), "w") as f:
    f.write("#!/usr/bin/env python3\n\"\"\"Print the five most delayed trains from a dispatch log.\"\"\"\n"
            "import re, sys\nfrom collections import Counter\n\n"
            "c = Counter()\nfor line in open(sys.argv[1]):\n"
            "    m = re.search(r'train (\\d+) delayed (\\d+) min', line)\n"
            "    if m:\n        c[m.group(1)] += int(m.group(2))\n"
            "for t, mins in c.most_common(5):\n    print(t, mins)\n")
with open(os.path.join(root, "README"), "w") as f:
    f.write("CloudTrain sample data (fictional): csv/ logs/ text/ configs/ projects/.\n"
            "Read-only reference copies; labs copy what they need into the learner's home.\n")
