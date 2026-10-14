#!/bin/bash
# Fails when a production dependency in THIRD_PARTY_LICENSES.md is under a
# copyleft license that CloudTrain may not link (GPL, LGPL, AGPL, SSPL), or has
# no recognised license. Run after tools/licenses/inventory.sh (CI: ci.yml).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
file=${1:-$root/THIRD_PARTY_LICENSES.md}
# Table rows only: "| name | [version |] license |", skipping headers and rules.
bad=$(awk -F'|' 'NF >= 4 && $2 !~ /^ *(Package|Module|-+) *$/ {
  lic = $(NF - 1); gsub(/^ +| +$/, "", lic); name = $2; gsub(/^ +| +$/, "", name)
  if (lic ~ /(^|[^A-Za-z])(A|L)?GPL|SSPL/ || lic == "" || lic ~ /^(UNKNOWN|Unknown|NOASSERTION)$/) print name ": " lic
}' "$file")
if [[ -n $bad ]]; then
  echo "Disallowed or unknown licenses in production dependencies:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "license gate: $(grep -c '^| ' "$file") rows, no GPL/LGPL/AGPL/SSPL or unknown licenses"
