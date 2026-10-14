#!/bin/bash
# Grader harness: run ~/bin/fare-report on hidden case N as the learner and compare
# stdout with cases/N.expect byte for byte.
n=$1; c=/var/lib/cloudtrain/cases; tool=/home/learner/bin/fare-report
[ -x "$tool" ] || { echo "fail: not executable"; exit 0; }
tmp=$(mktemp -d); chmod 0755 "$tmp"; cp "$c/$n.log" "$tmp/fares.log"; chmod 0644 "$tmp/fares.log"
(cd /tmp && timeout 20 runuser -u learner -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/learner "$tool" "$tmp/fares.log") > "$tmp/out" 2>/dev/null
rc=$?
if [ $rc -eq 0 ] && cmp -s "$tmp/out" "$c/$n.expect"; then echo pass; else echo "fail: rc=$rc"; diff "$c/$n.expect" "$tmp/out" | head -5; fi
rm -rf "$tmp"
