#!/bin/bash
# Test-only shim emulating the missing platform L2 support on THIS stream's
# verify sessions (label labs.cloudtrain.dev/verify=networking): adds "unknown"
# to every link logical switch port and vlan-passthru=true to every link switch.
C="kubectl --context kind-cloudtrain-dev -n kube-system exec deploy/ovn-central -c ovn-central --"
while :; do
  for ns in $(kubectl --context kind-cloudtrain-dev get labsession -A -l labs.cloudtrain.dev/verify=networking -o jsonpath='{range .items[*]}{.metadata.namespace}{"\n"}{end}' 2>/dev/null | sort -u); do
    $C ovn-nbctl --format=csv --no-headings --columns=name,addresses,type list Logical_Switch_Port 2>/dev/null \
      | grep -F ".$ns." | grep -- '-link-' | grep -v ',router$' | grep -v 'unknown' | cut -d, -f1 | while read -r lsp; do
        a=$($C ovn-nbctl lsp-get-addresses "$lsp" 2>/dev/null | head -1); [ -n "$a" ] && $C ovn-nbctl lsp-set-addresses "$lsp" "$a" unknown && echo "$(date +%T) unknown $lsp"
      done
    for ls in $($C ovn-nbctl --bare --columns=name list Logical_Switch 2>/dev/null | grep "^$ns-.*-link-"); do
      $C ovn-nbctl get Logical_Switch "$ls" other_config:vlan-passthru >/dev/null 2>&1 || { $C ovn-nbctl set Logical_Switch "$ls" other_config:vlan-passthru=true && echo "$(date +%T) passthru $ls"; }
    done
  done
  sleep 2
done
