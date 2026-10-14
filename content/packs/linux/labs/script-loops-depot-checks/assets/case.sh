#!/bin/bash
# Grader harness: run the learner's check-depots on hidden case N as the learner.
# cases/N.list = input file, N.expect = expected /var/tmp/unreachable.txt then "rc=<code>".
n=$1; c=/var/lib/cloudtrain/cases; tool=/home/learner/bin/check-depots
[ -x "$tool" ] || { echo "fail: not executable"; exit 0; }
tmp=$(mktemp -d); chmod 0755 "$tmp"; cp "$c/$n.list" "$tmp/depots.txt"; chmod 0644 "$tmp/depots.txt"
out=/var/tmp/unreachable.txt
if [ -f "$c/$n.stale" ]; then cp "$c/$n.stale" "$out"; else rm -f "$out"; fi
chown learner:learner "$out" 2>/dev/null || true
start=$(date +%s)
(cd /home/learner && timeout 40 runuser -u learner -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/learner "$tool" "$tmp/depots.txt" >/dev/null 2>&1)
rc=$?; took=$(( $(date +%s) - start ))
rm -rf "$tmp"
[ $rc = 124 ] && { echo "fail: still running after 40s"; exit 0; }
got=$( { cat "$out" 2>/dev/null; echo "rc=$rc"; } | sed '/^$/d')
want=$(sed '/^$/d' "$c/$n.expect")
[ "$got" = "$want" ] && echo pass || echo "fail: took ${took}s got [$(echo "$got" | tr '\n' ' ')] want [$(echo "$want" | tr '\n' ' ')]"
