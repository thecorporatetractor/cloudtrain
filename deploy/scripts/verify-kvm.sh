#!/usr/bin/env bash
# Prove KubeVirt runs guests with hardware KVM (not TCG emulation):
#  1. every node advertises devices.kubevirt.io/kvm
#  2. a throwaway VMI boots and libvirt reports <domain type='kvm'>
source "$(dirname "$0")/lib.sh"
NS=cloudtrain-kvm-check

emu=$(k -n kubevirt get kv kubevirt -o jsonpath='{.spec.configuration.developerConfiguration.useEmulation}')
[[ "$emu" != "true" ]] || die "KubeVirt useEmulation=true; refusing to call that KVM"

wait_for "nodes advertise devices.kubevirt.io/kvm" 300 bash -c \
  "[[ \$(kubectl --context $KUBECONTEXT get nodes -o jsonpath='{.items[*].status.allocatable.devices\.kubevirt\.io/kvm}' | wc -w) -ge 1 ]]"
k get nodes -o custom-columns='NODE:.metadata.name,KVM:.status.allocatable.devices\.kubevirt\.io/kvm,VHOST:.status.allocatable.devices\.kubevirt\.io/vhost-net,TUN:.status.allocatable.devices\.kubevirt\.io/tun'

k create ns "$NS" --dry-run=client -o yaml | k apply -f - >/dev/null
cat <<EOF | k apply -f - >/dev/null
apiVersion: kubevirt.io/v1
kind: VirtualMachineInstance
metadata:
  name: kvm-probe
  namespace: $NS
spec:
  domain:
    cpu: { cores: 1 }
    resources: { requests: { memory: 128Mi } }
    devices:
      disks: [{ name: root, disk: { bus: virtio } }]
      interfaces: [{ name: default, masquerade: {} }]
  networks: [{ name: default, pod: {} }]
  volumes:
    - name: root
      containerDisk: { image: quay.io/kubevirt/cirros-container-disk-demo:${KUBEVIRT_VERSION} }
EOF
start=$SECONDS
k -n "$NS" wait vmi/kvm-probe --for=condition=Ready --timeout=300s >/dev/null \
  || { k -n "$NS" describe vmi kvm-probe | tail -30; die "probe VMI did not become Ready"; }
log "probe VMI Ready in $((SECONDS - start))s"
pod=$(k -n "$NS" get pod -l kubevirt.io/created-by="$(k -n "$NS" get vmi kvm-probe -o jsonpath='{.metadata.uid}')" -o name | head -1)
dtype=$(k -n "$NS" exec "$pod" -c compute -- virsh -c qemu+unix:///session?socket=/var/run/libvirt/virtqemud-sock dumpxml 1 2>/dev/null \
        | grep -o "<domain type='[a-z]*'" || true)
if [[ -z $dtype ]]; then
  dtype=$(k -n "$NS" exec "$pod" -c compute -- sh -c 'virsh list --name | head -1 | xargs -r virsh dumpxml' 2>/dev/null | grep -o "<domain type='[a-z]*'" || true)
fi
k delete ns "$NS" --wait=false >/dev/null
[[ $dtype == "<domain type='kvm'" ]] || die "probe VMI is not using KVM (libvirt: '${dtype:-unknown}')"
log "KVM verified: libvirt $dtype"
