#!/bin/bash
# stage.sh <lab>: move a draft into the pack (status built) and run static validation
set -e
R=/home/hackrvl/cloudtrain/.worktrees/net-r3; S=/tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking
lab=$1; cd $R
if [ -d docs/handoffs/networking-drafts/$lab ]; then rm -rf content/packs/networking/labs/$lab; git mv docs/handoffs/networking-drafts/$lab content/packs/networking/labs/$lab; fi
python3 $S/setstatus.py . $lab built
python3 $S/sync_pack.py .
node tools/lab-verify/bin/lab-verify.mjs --strict 2>&1 | grep -E '^(ERROR|WARN)|error\(s\)|warning' || true
services/lab-orchestrator/bin/labctl validate content/packs/networking/labs/$lab | tail -3
