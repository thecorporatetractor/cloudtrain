#!/bin/sh
# Writes the deployer token and the cluster coordinates for ~/exam/forecast-token
# (run as the learner, before seed.sh).
set -eu
d=$HOME/exam/forecast-token
mkdir -p "$d"
[ -s "$d/deployer.token" ] && exit 0
for i in $(seq 1 30); do
  t=$(kubectl --context sm-grid -n forecast-token get secret deployer-token -o jsonpath='{.data.token}' 2>/dev/null | base64 -d 2>/dev/null) || true
  [ -n "$t" ] && break; sleep 2
done
[ -n "$t" ]
umask 077; printf '%s' "$t" > "$d/deployer.token"
host=$(kubectl config view --raw --minify --context sm-grid -o jsonpath='{.clusters[0].cluster.server}')
ca=$(kubectl config view --raw --minify --context sm-grid -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d)
{ printf 'cluster_host = "%s"\n' "$host"; printf 'cluster_ca   = <<-EOT\n%s\nEOT\n' "$ca"; } > "$d/cluster.auto.tfvars"
