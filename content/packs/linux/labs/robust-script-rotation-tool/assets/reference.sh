#!/bin/bash
# Reference rotate-roster (grader only).
set -euo pipefail
usage() { echo "usage: rotate-roster.sh -d DIR -w WEEK [-n SHIFT]"; }
dir= week= shift_n=1
while getopts ':d:w:n:h' o; do
  case $o in d) dir=$OPTARG ;; w) week=$OPTARG ;; n) shift_n=$OPTARG ;; h) usage; exit 0 ;; *) usage >&2; exit 2 ;; esac
done
[ -n "$dir" ] && [ -n "$week" ] || { usage >&2; exit 2; }
arch="$dir/archive/roster-$week.csv"
[ -e "$arch" ] && { echo "already rotated"; exit 0; }
tmp=$(mktemp "$dir/.current.XXXXXX"); trap 'rm -f "$tmp" "${atmp:-}"' EXIT
tr-crewshift "$shift_n" < "$dir/current.csv" > "$tmp"
mkdir -p "$dir/archive"
atmp=$(mktemp "$dir/archive/.roster.XXXXXX"); cp "$dir/current.csv" "$atmp"; mv "$atmp" "$arch"
chmod 0644 "$tmp"; mv "$tmp" "$dir/current.csv"
