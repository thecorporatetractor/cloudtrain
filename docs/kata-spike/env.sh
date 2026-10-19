# kata spike env (sourced on ct-testvm)
source ~/.profile
export W=/srv/ct-work/dev/kata
export KUBECONFIG=$W/kubeconfig
export CT_CLUSTER_NAME=ct-kata
export KIND_CONFIG=$W/kind-ct-kata.yaml
export CT_SLOTS_ENV=/srv/ct-work/vm-config/runner.env
export GOTOOLCHAIN=go1.27.2
export PATH=/usr/local/go/bin:$HOME/.local/bin:$PATH
kk() { kubectl --context kind-ct-kata "$@"; }
