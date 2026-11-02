#!/bin/sh
# Containers on this VM reach the Instance Metadata Service, and so the VM's managed identity, only
# from the sidecar's fixed address (compose.yaml). A compromised Caddy gets no token. Caddy also
# starts no outbound connection at all: it serves files and talks to the sidecar.
#
# The host's own firewall unit (first boot) sets the IMDS rule for the sidecar too. This repeats it,
# which does no harm, and adds Caddy's outbound block. DOCKER-USER is the chain Docker leaves to the
# administrator, and it is empty after a reboot until something fills it. Safe to run again: it
# replaces its own rules.
set -eu

SIDECAR=${SIDECAR_IP:-10.250.50.20}
CADDY=${CADDY_IP:-10.250.50.10}
SUBNET=${SITE_SUBNET:-10.250.50.0/24}
IMDS=169.254.169.254/32
TAG=cloudtrain-site

# Removes the rules of an earlier run, by their comment.
iptables -S DOCKER-USER | grep -- "--comment $TAG" | sed 's/^-A /-D /' | while read -r rule; do
  # shellcheck disable=SC2086 # the rule is a list of arguments
  iptables $rule
done

# Inserted in reverse: the first line below ends up last in the chain.
iptables -I DOCKER-USER -s "$CADDY" ! -d "$SUBNET" -m conntrack --ctstate NEW -m comment --comment "$TAG" -j DROP
iptables -I DOCKER-USER -d "$IMDS" -m comment --comment "$TAG" -j DROP
iptables -I DOCKER-USER -s "$SIDECAR" -d "$IMDS" -m comment --comment "$TAG" -j RETURN

iptables -S DOCKER-USER | grep -- "--comment $TAG"
