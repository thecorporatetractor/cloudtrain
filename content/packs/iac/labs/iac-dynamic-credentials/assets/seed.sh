#!/bin/sh
# Seeds and applies ~/stacks/telemetry-deploy once, authenticating with the legacy token.
set -eu
d=$HOME/stacks/telemetry-deploy
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cl=$(kubectl config view -o jsonpath='{.contexts[?(@.name=="sm-grid")].context.cluster}')
host=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.server}")
ca=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.certificate-authority-data}")
printf 'host   = "%s"\nca_b64 = "%s"\n' "$host" "$ca" > "$d/cluster.auto.tfvars"
tok=$(kubectl --context sm-grid -n telemetry get secret telemetry-deployer-legacy -o jsonpath='{.data.token}' | base64 -d)
printf 'deployer_token = "%s"\n' "$tok" > "$d/deployer.auto.tfvars"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
