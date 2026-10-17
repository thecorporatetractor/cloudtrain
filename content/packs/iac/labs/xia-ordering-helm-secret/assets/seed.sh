#!/bin/sh
# Seeds ~/exam/DIR once from /var/tmp/ct-seed/ID/stack (a recreated pod must not
# overwrite the candidate's work), then runs nothing, init, or init + apply.
#   seed.sh ID DIR [none|init|apply]
set -eu
id=$1; d=$HOME/exam/$2; mode=${3:-init}
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp -R "/var/tmp/ct-seed/$id/stack/." "$d/"
# Chart templates use [[ ]] in the lab source (assets are templated); restore Helm braces.
[ -d "$d/charts" ] && find "$d/charts" -name "*.yaml" -exec sed -i -e "s/\[\[/{{/g" -e "s/\]\]/}}/g" {} +
cd "$d"
case $mode in
  none) ;;
  init) iac init -input=false -no-color >/dev/null ;;
  apply) iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null ;;
esac
touch .ct-seeded
