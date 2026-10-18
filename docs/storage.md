# Storage

CloudTrain runs on any Kubernetes (kind, vSphere, AKS, EKS, GKE, bare metal). It
never names a StorageClass in code, labs or content; the operator picks classes
with manager flags, and everything else follows the cluster.

## What uses storage

| Volume | Created by | Default class |
|---|---|---|
| Learner home (`/home/learner` PVC, RWO, Filesystem) | orchestrator, `--persistent-home` | `--home-storage-class`, else `--storage-class`, else cluster default |
| vcluster database PVC | orchestrator (vcluster chart values), `--vcluster-persistence` | same as homes |
| VM root and data disks (CDI DataVolume) | orchestrator, `--vm-disks=persistent` | `--vm-disk-storage-class`, else `--storage-class`, else cluster default |
| CDI import scratch space | CDI | `scratchSpaceStorageClass` of the CDI CR, else cluster default |

Labs that teach storage (xka-default-storageclass, xka-retain-reclaim,
xka-expand-claim, csi-driver-inventory, manifest-store-dynamic) run in
kubeadm lab VMs with their own in-lab provisioner and StorageClasses; they do not
touch the host cluster's classes. Lab specs and content must not name a host
class.

## Flags (lab-orchestrator manager)

| Flag | Default | Meaning |
|---|---|---|
| `--storage-class` | empty | Class for everything; empty = cluster default class |
| `--home-storage-class` | empty | Override for homes and vcluster databases |
| `--vm-disk-storage-class` | empty | Override for VM disks |
| `--vm-disk-volume-mode` | empty | `Block` or `Filesystem`; empty = the class's CDI StorageProfile decides (Block where the class supports it) |
| `--vm-disk-access-modes` | `ReadWriteOnce` | A VM disk is mounted by one VM, so RWO works on every class |
| `--storage-preflight` | `warn` | Startup check: `warn` logs, `strict` exits when a configured class is missing, `off` skips |

Preflight: every class named by a flag must exist; if a volume type relies on
the cluster default and no class is marked default, the manager logs a warning
(PVCs would stay Pending). It needs `get,list` on `storage.k8s.io/storageclasses`
(in the shipped ClusterRole); without it the check is skipped with a warning.

All PVCs use the class's own binding mode, so `WaitForFirstConsumer` classes work
and nothing assumes node-local paths or a fixed node. VM disks are CDI
DataVolumes with the `storage` API: omitted fields are completed from the
StorageProfile.

`deploy/scripts/orchestrator-deploy.sh` maps `STORAGE_CLASS`, `HOME_STORAGE_CLASS`,
`VM_DISK_STORAGE_CLASS`, `VM_DISK_VOLUME_MODE` and `VM_DISK_ACCESS_MODES` to these
flags. `task dev:up` on kind keeps `standard` (local-path) for CDI scratch space
(`DEV_STORAGE_CLASS`, empty = cluster default); with no flags set, kind behaves
as before.

## Per-provider examples

```
# AKS (Azure Disk CSI)
--storage-class=managed-csi --vm-disk-volume-mode=Block
# EKS (EBS CSI, gp3)
--storage-class=gp3 --vm-disk-volume-mode=Block
# GKE (PD CSI, WaitForFirstConsumer)
--storage-class=standard-rwo --vm-disk-volume-mode=Block
# vSphere CSI
--storage-class=<vsphere-sc> --vm-disk-volume-mode=Filesystem
# kind / bare metal with one default class: set nothing
```

Also set the CDI CR's `scratchSpaceStorageClass` if the default class cannot
provide scratch space. Block mode needs a CSI driver with raw block support
(Azure Disk, EBS, PD do; vSphere CSI block is RWO only, so Filesystem is the safe
choice there).
