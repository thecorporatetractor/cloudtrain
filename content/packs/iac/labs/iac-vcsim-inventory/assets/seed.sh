#!/bin/sh
# Starts the simulated vCenter with Saltmarsh names and seeds ~/stacks/vsphere-farms once
# (a recreated pod must not overwrite the learner's work). vcsim keeps its inventory in
# memory: after a restart `vcsim.py init` restores the names, objects must be re-applied.
set -eu
ct-vcsim start -host 1 -vm 0 -standalone-host 0
python3 /var/tmp/ct-seed/vcsim.py init
d=$HOME/stacks/vsphere-farms
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp -R /var/tmp/ct-seed/stack/. "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
