#!/bin/bash
# Writes the hidden grading cases and the learner-visible feed. Usage: make-cases.sh DAY
set -eu
day=$1
c=/var/lib/cloudtrain/cases; rm -rf "$c"; mkdir -p "$c"
H='date,train,station,delay_min,reported_on'
# Visible feed: a week of data.
{
  echo "$H"
  for d in 01 02 03 04 05 06 07; do
    for i in 1 2 3 4 5; do
      echo "2026-10-$d,TR$((4500 + i * 7)),$(echo Ashby Bramwell Corran Dunmere Elsford | cut -d' ' -f$i),$(( (10#$d * 7 + i * 11) % 37 )),2026-10-$d"
    done
  done
} > /srv/delays/feed.csv
# Case 1: the visible feed, default location (no DELAY_FEED), the lab's day.
echo "2026-10-$day" > $c/1.args
awk -F, -v d="2026-10-$day" '$1 == d {t += $4; if (!n++ || $4 > w) w = $4} END {print "total=" t; print "worst=" w; print "rc=0"}' /srv/delays/feed.csv > $c/1.expect
# Case 2: several rows, some reported a day later; other days reported on the test day.
cat > $c/2.feed <<F
$H
2026-11-02,TR1001,Ashby,12,2026-11-02
2026-11-02,TR1002,Garth,31,2026-11-03
2026-11-01,TR1003,Garth,55,2026-11-02
2026-11-02,TR1004,Hollin,7,2026-11-02
2026-11-03,TR1005,Ashby,90,2026-11-03
F
echo 2026-11-02 > $c/2.args; printf 'total=50\nworst=31\nrc=0\n' > $c/2.expect
# Case 3: one row only.
printf '%s\n2026-12-24,TR2001,Corran,4,2026-12-24\n2026-12-25,TR2002,Corran,9,2026-12-25\n' "$H" > $c/3.feed
echo 2026-12-24 > $c/3.args; printf 'total=4\nworst=4\nrc=0\n' > $c/3.expect
# Case 4: the day has data, but every train was on time.
printf '%s\n2027-01-05,TR3001,Ashby,0,2027-01-05\n2027-01-05,TR3002,Bramwell,0,2027-01-05\n2027-01-06,TR3003,Ashby,15,2027-01-06\n' "$H" > $c/4.feed
echo 2027-01-05 > $c/4.args; printf 'total=0\nworst=0\nrc=0\n' > $c/4.expect
# Case 5: no data for the day (only reported on it) -> exit 2, nothing on stdout.
printf '%s\n2027-02-01,TR4001,Ashby,22,2027-02-02\n2027-02-03,TR4002,Ashby,3,2027-02-03\n' "$H" > $c/5.feed
echo 2027-02-02 > $c/5.args; printf 'rc=2\n' > $c/5.expect
# Case 6: no argument -> exit 1.
: > $c/6.args; cp $c/2.feed $c/6.feed; printf 'rc=1\n' > $c/6.expect
# Case 7: a larger delay sorts below a smaller one as text (100 vs 99).
printf '%s\n2027-03-01,TR5001,Ashby,99,2027-03-01\n2027-03-01,TR5002,Garth,100,2027-03-01\n2027-03-01,TR5003,Garth,8,2027-03-01\n' "$H" > $c/7.feed
echo 2027-03-01 > $c/7.args; printf 'total=207\nworst=100\nrc=0\n' > $c/7.expect
chmod -R go-rwx $c
