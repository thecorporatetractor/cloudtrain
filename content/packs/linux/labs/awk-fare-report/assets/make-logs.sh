#!/bin/bash
# make-logs.sh SALT: writes this week's log and the hidden grading cases.
set -eu
salt=$1; c=/var/lib/cloudtrain/cases; rm -rf $c; mkdir -p $c /srv/fares
gen() { # gen SEED LINES MAXZONE SHUFFLE
  awk -v seed="$1" -v n="$2" -v mz="$3" -v sh="$4" 'BEGIN {
    srand(seed)
    for (i = 1; i <= n; i++) {
      z = int(rand() * mz) + 1; f = sprintf("%.2f", 1.5 + z * 0.85 + int(rand() * 4) * 0.25)
      st = (rand() < 0.12) ? "DECLINED" : "OK"
      ts = sprintf("2026-10-%02dT%02d:%02d:%02d", 5 + int(i / 200), 5 + int(rand() * 18), int(rand() * 60), int(rand() * 60))
      a[1] = "gate=G" int(rand() * 40); a[2] = "card=****" int(1000 + rand() * 8999); a[3] = "zone=" z; a[4] = "fare=" f; a[5] = "status=" st
      if (sh && rand() < 0.3) { t = a[3]; a[3] = a[5]; a[5] = t }
      if (sh && rand() < 0.2) { t = a[1]; a[1] = a[4]; a[4] = t }
      printf "%s %s %s %s %s %s\n", ts, a[1], a[2], a[3], a[4], a[5]
    }
  }'
}
gen "$salt" 600 6 0 > /srv/fares/fares-week41.log
# 1: this week's log; 2: fields in varying order; 3: zones up to 11 (numeric order);
# 4: integer fares; 5: only declined journeys.
gen $((salt + 1)) 300 6 1 > $c/2.log
gen $((salt + 2)) 400 11 0 > $c/3.log
printf '2026-10-12T08:00:00 gate=G1 card=****1111 zone=1 fare=3 status=OK\n2026-10-12T08:01:00 gate=G1 card=****2222 zone=2 fare=4 status=OK\n2026-10-12T08:02:00 gate=G2 card=****3333 zone=1 fare=3 status=OK\n2026-10-12T08:03:00 gate=G2 card=****4444 zone=2 fare=4.5 status=DECLINED\n' > $c/4.log
printf '2026-10-12T09:00:00 gate=G7 card=****5555 zone=3 fare=5.10 status=DECLINED\n2026-10-12T09:05:00 gate=G7 card=****6666 zone=4 fare=6.00 status=DECLINED\n' > $c/5.log
cp /srv/fares/fares-week41.log $c/1.log
for i in 1 2 3 4 5; do awk -f /var/lib/cloudtrain/reference.awk $c/$i.log > $c/$i.expect; done
chmod 0644 /srv/fares/fares-week41.log
