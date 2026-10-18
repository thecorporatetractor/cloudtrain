#!/bin/bash
# Seeds ~/stacks/inland once: history fenwick only -> fenwick + larkholt (the good,
# current state) -> a bad `state push -force` of an old local copy (fenwick only).
set -euo pipefail
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
d=$HOME/stacks/inland ids=$HOME/.local/share/ct-lab
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$ids" "$HOME/inland" "$HOME/reports"
cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color -var 'farms=["fenwick"]' >/dev/null
iac state pull > /tmp/ct-old-copy.tfstate          # someone's laptop copy, taken here
iac apply -auto-approve -input=false -no-color >/dev/null   # larkholt joins: the good state
iac state pull | jq -r '[.resources[] | select(.type == "random_pet") | .instances[] | .attributes.id] | sort | join(" ")' > "$ids/pets"
ct-s3 api GET '/saltmarsh-state?versions&prefix=inland/terraform.tfstate' | python3 -c '
import sys, xml.etree.ElementTree as E
ns = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
for v in E.fromstring(sys.stdin.read()).findall("s:Version", ns):
    if v.findtext("s:Key", namespaces=ns) == "inland/terraform.tfstate" and v.findtext("s:IsLatest", namespaces=ns) == "true":
        print(v.findtext("s:VersionId", namespaces=ns))' > "$ids/good.version"
[ -s "$ids/good.version" ]
iac state push -force /tmp/ct-old-copy.tfstate        # the bad push
rm -f /tmp/ct-old-copy.tfstate
touch .ct-seeded
