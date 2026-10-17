#!/bin/sh
# Seeds ~/stacks/collector once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/collector
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/charts/collector/templates"
cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cp /var/tmp/ct-seed/Chart.yaml /var/tmp/ct-seed/values.yaml "$d/charts/collector/"
# Chart templates use [[ ]] in the lab source (lab assets are templated); restore Helm's braces.
sed -e 's/\[\[/{{/g' -e 's/\]\]/}}/g' /var/tmp/ct-seed/deployment.yaml > "$d/charts/collector/templates/deployment.yaml"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
