#!/bin/sh
# Seeds the offline chart repository ~/charts and ~/stacks/farm-dash once (a recreated pod
# must not overwrite the learner's work). Chart templates use [[ ]] in the lab source
# (assets are templated); Helm braces are restored here.
set -eu
s=/var/tmp/ct-seed; d=$HOME/stacks/farm-dash
[ -e "$d/.ct-seeded" ] && exit 0
rm -rf "$HOME/.cache/ct-chart" && mkdir -p "$HOME/.cache/ct-chart" "$HOME/charts"
cp -R "$s/chart" "$HOME/.cache/ct-chart/scada-dashboard"
find "$HOME/.cache/ct-chart" -name "*.yaml" -exec sed -i -e "s/\[\[/{{/g" -e "s/\]\]/}}/g" {} +
helm package "$HOME/.cache/ct-chart/scada-dashboard" -d "$HOME/charts" >/dev/null
helm repo index "$HOME/charts" >/dev/null
rm -rf "$HOME/.cache/ct-chart"
mkdir -p "$d" && cp -R "$s/stack/." "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
