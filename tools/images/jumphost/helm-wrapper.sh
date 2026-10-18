#!/bin/sh
# /usr/local/bin/helm on the learner workstation: Helm 4 (/usr/local/lib/cloudtrain/helm)
# with client-side apply as the default for install and upgrade, as in Helm 3.
#
# Why: lab clusters of mode virtual are vclusters. vcluster creates every virtual Service
# itself (its API proxy redirects the create to the host first, and the syncer recreates a
# virtual Service whose ClusterIP differs from the host's), so field manager "vcluster"
# owns all of the Service's fields, labels included. Helm 4 applies server-side by default,
# and the next `helm upgrade` that changes a label (helm.sh/chart does on every chart
# version) fails with "conflict with \"vcluster\"". No vcluster setting or version (checked
# up to 0.38.0-alpha.4) avoids that; client-side apply has no field conflicts.
# An explicit --server-side[=...] or --force-conflicts on the command line wins.
real=/usr/local/lib/cloudtrain/helm
sub=
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case $a in
    --server-side | --server-side=* | --force-conflicts) exec "$real" "$@" ;;
    -n | --namespace | --kube-context | --kubeconfig | --kube-apiserver | --kube-as-user | --kube-as-group | \
      --kube-ca-file | --kube-token | --kube-tls-server-name | --registry-config | --repository-config | \
      --repository-cache | --burst-limit | --qps | --color | --colour | --content-cache)
      skip=1 ;;
    -*) ;;
    *) [ -z "$sub" ] && sub=$a ;;
  esac
done
case $sub in
  install | upgrade) exec "$real" "$@" --server-side=false ;;
esac
exec "$real" "$@"
