#!/bin/bash
# Grader harness: run the learner's delay-summary on hidden case N as the learner.
# Prints "pass" or "fail: <details>". Case files: cases/N.feed (optional), N.args,
# N.expect (expected stdout followed by a line "rc=<code>").
n=$1; c=/var/lib/cloudtrain/cases
tool=/usr/local/bin/delay-summary
[ -x "$tool" ] || { echo "fail: not executable"; exit 0; }
tmp=$(mktemp -d); chmod 0755 "$tmp"
env=()
if [ -f "$c/$n.feed" ]; then cp "$c/$n.feed" "$tmp/feed.csv"; chmod 0644 "$tmp/feed.csv"; env=(DELAY_FEED="$tmp/feed.csv"); fi
read -r -a args < "$c/$n.args" || true
out=$(cd /tmp && timeout 10 runuser -u learner -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/learner "${env[@]}" "$tool" "${args[@]}" 2>/dev/null)
rc=$?
rm -rf "$tmp"
got=$(printf '%s\nrc=%s' "$out" "$rc" | sed '/^$/d')
want=$(sed '/^$/d' "$c/$n.expect")
[ "$got" = "$want" ] && echo pass || echo "fail: got [$(echo "$got" | tr '\n' ' ')] want [$(echo "$want" | tr '\n' ' ')]"
