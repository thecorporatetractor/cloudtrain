#!/bin/sh
# Seeds and applies ~/stacks/forecast-deploy once.
set -eu
d=$HOME/stacks/forecast-deploy
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cl=$(kubectl config view -o jsonpath='{.contexts[?(@.name=="sm-grid")].context.cluster}')
host=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.server}")
ca=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.certificate-authority-data}")
printf 'host   = "%s"\nca_b64 = "%s"\n' "$host" "$ca" > "$d/cluster.auto.tfvars"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
