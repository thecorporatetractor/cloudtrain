#!/bin/bash
# v.sh <lab-id> [extra labctl flags]  - live verify one networking lab through the pod slot
R=/home/hackrvl/cloudtrain/.worktrees/b-networking
lab=$1; shift
cd $R/services/lab-orchestrator
/home/hackrvl/cloudtrain/tools/slots/run.sh pod -- timeout 3000 bin/labctl verify --context kind-cloudtrain-dev --repo-root $R \
  --session-label labs.cloudtrain.dev/verify=networking --parallel 2 "$@" $R/content/packs/networking/labs/$lab 2>&1 \
  | grep -v 'Provisioning: waiting for nodes' > /tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking/v-$lab.log
rc=${PIPESTATUS[0]}
grep -E 'FAIL|LAB |^net|^xnt|lab\(s\)' /tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking/v-$lab.log | tail -30
exit $rc
