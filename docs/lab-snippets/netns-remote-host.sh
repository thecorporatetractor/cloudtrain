#!/bin/sh
# Reference snippet: a "remote host" inside one VM, built from a network namespace.
# Used by Linux labs that need a second machine without a second VM (firewalls, routes,
# time sync). It is pasted into a lab's setup (labs cannot source files outside their own
# directory); keep the copies in step with this file.
#
# Layout (replace ROLE and NET per lab; NET is a 10.6x.y prefix unique to the lab):
#   VM:         v-ROLE        NET.1/24
#   namespace:  v-ROLE-p      NET.2/24   (namespace tr-ROLE)
#   remote subnet (optional): a dummy interface rem0 inside the namespace.
# Rules: never touch eth0, the VM's default route or its DNS; delete first so a re-run
# of setup is idempotent; interface names stay under 15 characters.
set -eu
ROLE=rem      # e.g. ntp, cl, rem
NET=10.62.4   # per-lab /24
ip netns del tr-$ROLE 2>/dev/null || true
ip link del v-$ROLE 2>/dev/null || true
ip netns add tr-$ROLE
ip link add v-$ROLE type veth peer name v-$ROLE-p
ip link set v-$ROLE-p netns tr-$ROLE
ip addr add $NET.1/24 dev v-$ROLE
ip link set v-$ROLE up
ip -n tr-$ROLE addr add $NET.2/24 dev v-$ROLE-p
ip -n tr-$ROLE link set v-$ROLE-p up
ip -n tr-$ROLE link set lo up
# optional: the remote subnet lives on a dummy interface in the namespace
ip -n tr-$ROLE link add rem0 type dummy
ip -n tr-$ROLE addr add 10.91.4.10/24 dev rem0
ip -n tr-$ROLE addr add 10.91.4.200/24 dev rem0
ip -n tr-$ROLE link set rem0 up
# run a client or daemon "on the remote host":  ip netns exec tr-$ROLE <command>
