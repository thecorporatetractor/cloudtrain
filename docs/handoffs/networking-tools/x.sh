#!/bin/bash
# x.sh <ns> <node> <cmd...>  exec in lab node container
NS=$1; n=$2; shift 2
K="kubectl --context kind-cloudtrain-dev -n $NS"
p=$($K get pods -o name | grep -- "-$n-" | head -1)
$K exec $p -c node -- sh -c "$*"
