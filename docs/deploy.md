# Deploying CloudTrain

How the platform's images and lab images get from CI to a cluster's nodes on any
Kubernetes. Design background: [any-kubernetes.md](any-kubernetes.md) (sections 1.7
and 5, decision 9).

## Images and registries

### Where images come from

GHCR is the signed source of every image CloudTrain publishes:

| Image | Built by | Published as |
|---|---|---|
| Platform: `lab-orchestrator`, `gateway`, `web` | `.github/workflows/images.yml` | `ghcr.io/<owner>/<repo>/<name>` |
| Lab containers marked `publishable: true` in `deploy/images/catalog.yaml` (jumphost, frr, nettools, netsvc, oci-registry, iac-ws-tofu, ansible-ctl, kql-ws) | the same workflow | `ghcr.io/<owner>/<repo>/<publishName>` |
| Lab containerDisks (kubeadm-node, etcd-host, el-vm, ubuntu-vm, docker-vm) and the tier-A Linux pods (el-lab, deb-lab) | locally or on the verify VM today (they need KVM or the package mirror) | not yet; see [Publishing containerDisks](#publishing-containerdisks-design) |

Every push to `main` and every `v*` tag pushes with the branch, `sha-<commit>` and
semver tags, a cosign keyless signature, SLSA provenance and an SBOM attestation.
Pull requests build and scan only.

**Restricted images are never published.** A catalog entry is published only when it
says `publishable: true`. `labctl catalog check` runs in CI (the `go` job) and fails when
the workflow publishes a name that no publishable entry carries. The Terraform
workstation (`terraform-ws:1.15`, image `cloudtrain/iac-ws:1.15-terraform`, BUSL-1.1)
is `publishable: false`. Only the OpenTofu flavour is published, as `iac-ws-tofu`
(`deploy/images/overlays/iac-opentofu.yaml`). Upstream images (`moto:5`) are
`publishable: false` too: they are pulled from their own registry.

### The release catalog overlay

Lab content refers to images by catalog ref (`jumphost:1`, `kubeadm:1.37`). In dev,
the catalog maps them to local names (`cloudtrain/jumphost:1`) that
`task orchestrator:deploy` loads into kind. Those names would resolve to docker.io on
a real cluster, so a release ships an overlay instead: the `catalog overlay` job of
`images.yml` writes `catalog-release.yaml`, which maps every publishable ref to the
exact image CI pushed in that run:

```yaml
# labctl catalog overlay --catalog deploy/images/catalog.yaml,deploy/images/overlays/iac-opentofu.yaml \
#   --registry ghcr.io/<owner>/<repo> --digests <dir> --allow-missing
images:
  jumphost:1:
    kind: container
    image: ghcr.io/<owner>/<repo>/jumphost@sha256:...
    publishable: true
  terraform-ws:1.15:             # public releases run the OpenTofu flavour
    kind: container
    image: ghcr.io/<owner>/<repo>/iac-ws-tofu@sha256:...
```

It is a workflow artifact on every push and a release asset on `v*` tags. The
orchestrator merges it over the base catalog: in the Helm chart it is the value
`orchestrator.catalog.releaseOverlay`. Entries CI does not publish yet (containerDisks)
keep their base image, and the overlay header lists them. Pin by digest, not by tag:
a mirror keeps the digest, so the signature check below still holds after mirroring.

### Pulling from the cluster's own registry

Managed clusters usually pull from their provider's registry with the node identity
(no pull secrets) and must not depend on GHCR at run time. The orchestrator rewrites
registries at the moment it resolves an image. The overlay keeps naming GHCR, and the
cluster maps that prefix onto its mirror:

| Manager flag | Helm value | Effect |
|---|---|---|
| `--image-mirror from=to,...` | `orchestrator.images.mirrors` | rewrites the registry part of every lab image (pods and VM disks). The longest `from` wins. `docker.io` also matches unqualified refs (`busybox:1.37` = `docker.io/library/busybox:1.37`), so Docker Hub images (`moto`, the vcluster workload images) can come from a mirror too |
| `--image-registry <prefix>` | `orchestrator.images.registry` | prefixes unqualified catalog images (a registry laid out like the dev catalog, e.g. Harbor with `cloudtrain/jumphost:1` pushed) |
| `--image-pull-secrets a,b` | `orchestrator.images.pullSecrets` | Secrets in the session namespace that lab pods pull with. Ephemeral VM containerDisks use the first one. The chart can create the Secret from `imagePullSecrets.create` |

The catalog file itself can carry the same settings (`registry`, `mirrors`,
`imagePullSecrets` at the top level). The flags add to it or override it. Persistent VM
root disks are imported by CDI with `pullMethod: node`: the node's container runtime
pulls them, so they need node-level registry access (the provider integrations
below), not a pull secret.

The platform images (gateway, web, lab-orchestrator) are ordinary Deployment images.
Set `global.imageRegistry` in the chart to the mirror path that holds them.

#### Azure: ACR import (or ACR artifact cache)

```bash
ACR=myacr; SRC=ghcr.io/<owner>/<repo>
# The platform images (the chart's appVersion tag) and every digest in catalog-release.yaml:
for ref in $(yq '.images[].image' catalog-release.yaml | grep "^$SRC/"); do
  az acr import --name $ACR --source "$ref" --image "cloudtrain/${ref#$SRC/}" \
    ${GHCR_TOKEN:+--username "$GHCR_USER" --password "$GHCR_TOKEN"}
done
az aks update -g <rg> -n <cluster> --attach-acr $ACR   # node identity pulls, no secret
```

Values: `orchestrator.images.mirrors: ["ghcr.io/<owner>/<repo>=myacr.azurecr.io/cloudtrain"]`,
`global.imageRegistry: myacr.azurecr.io/cloudtrain`. `az acr import` keeps digests. An
ACR artifact cache rule (`az acr cache create --source-repo ghcr.io/<owner>/<repo>/*
--target-repo cloudtrain/*`, with a credential set for a private GHCR) pulls on first
use instead of importing ahead of time.

#### AWS: ECR pull-through cache

```bash
aws secretsmanager create-secret --name ecr-pullthroughcache/ghcr \
  --secret-string '{"username":"<github user>","accessToken":"<read:packages token>"}'
aws ecr create-pull-through-cache-rule --ecr-repository-prefix ghcr \
  --upstream-registry-url ghcr.io --credential-arn <secret arn>
aws ecr create-pull-through-cache-rule --ecr-repository-prefix docker-hub \
  --upstream-registry-url registry-1.docker.io --credential-arn <docker hub secret arn>
```

Values: `orchestrator.images.mirrors: ["ghcr.io=<acct>.dkr.ecr.<region>.amazonaws.com/ghcr",
"docker.io=<acct>.dkr.ecr.<region>.amazonaws.com/docker-hub"]` and
`global.imageRegistry: <acct>.dkr.ecr.<region>.amazonaws.com/ghcr/<owner>/<repo>`. The
node role needs `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, and on the first
pull `ecr:BatchImportUpstreamImage` and `ecr:CreateRepository` for the cache prefixes.
ECR's Docker Hub cache wants `library/` for official images; the `docker.io` mirror
adds it.

#### Google Cloud: Artifact Registry remote repository

```bash
gcloud artifacts repositories create ghcr --location=<region> --repository-format=docker \
  --mode=remote-repository --remote-docker-repo=https://ghcr.io \
  ${PRIVATE:+--remote-username=<github user> --remote-password-secret-version=<secret version>}
gcloud artifacts repositories create docker-hub --location=<region> --repository-format=docker \
  --mode=remote-repository --remote-docker-repo=DOCKER-HUB
```

Values: `orchestrator.images.mirrors: ["ghcr.io=<region>-docker.pkg.dev/<project>/ghcr",
"docker.io=<region>-docker.pkg.dev/<project>/docker-hub"]`,
`global.imageRegistry: <region>-docker.pkg.dev/<project>/ghcr/<owner>/<repo>`. The node
service account needs `roles/artifactregistry.reader`.

#### vCenter, bare metal: Harbor

A proxy-cache project (registry endpoint of type "Github GHCR", project `ghcr` with
proxy cache on) behaves like the caches above:
`orchestrator.images.mirrors: ["ghcr.io=harbor.example.com/ghcr", "docker.io=harbor.example.com/hub"]`.
For air-gapped sites, a pull-based replication rule copies the release's
repositories ahead of time; `cosign copy` brings the signatures along. When Harbor is
private, add a robot account as `imagePullSecrets.create` and
`orchestrator.images.pullSecrets`.
Nodes still need containerd to trust Harbor's CA.

### Verifying signatures

The mirror keeps the digest, so the GHCR signature verifies the mirrored image:

```bash
cosign verify ghcr.io/<owner>/<repo>/jumphost@sha256:... \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/<owner>/<repo>/\.github/workflows/images\.yml@refs/(heads/main|tags/v.+)$'
```

An admission policy (Kyverno `verifyImages`, Sigstore policy-controller) can enforce
the same identity on the mirror's repositories once signatures are copied there.

## Publishing containerDisks (design)

Status: plan, not built. Today the golden VM images are built by
`tools/images/build.sh` on a KVM machine (developer box or the verify VM) and loaded
into kind. Nothing publishes them, so a real cluster has no source for `kubeadm:*`,
`etcd-host`, `el-vm`, `ubuntu-vm` or `docker-vm` (catalog entries already
`publishable: true` with their `publishName`).

**Runner.** GitHub-hosted `ubuntu-24.04` runners expose `/dev/kvm` (nested
virtualization on the hosted VM). A udev rule makes it usable by the runner user:

```yaml
- name: Enable KVM
  run: |
    echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm.rules
    sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
    test -w /dev/kvm
```

The standard runner (4 vCPU, 16 GB RAM, ~14 GB guaranteed free disk, more after
removing preinstalled toolchains) fits one variant per job: the base cloud image
(~600 MB), the customised qcow2 (2-6 GB before sparsify) and the compressed
containerDisk. A larger runner (paid, 8-16 vCPU, 150+ GB) is only needed if
`kubeadm-full` outgrows it.

**Workflow `vm-images.yml`.**

| Step | What |
|---|---|
| Trigger | `push` to `main` and `v*` tags on `tools/images/**`, `deploy/versions.env`, `tools/images/lock/**`; `workflow_dispatch`; PRs build `etcd-host` only (smallest) as a smoke test |
| Matrix | `kubeadm-node`, `kubeadm-upgrade`, `etcd-host`, `docker-vm`, then `kubeadm-full` in a second job (`needs`), because it layers on the published `kubeadm-node` (pulled by digest instead of the local cache) |
| Build | `bash tools/images/build.sh <variant>` unchanged: pinned and checksum-verified inputs, lock files checked, `virt-customize` with KVM; `DOCKERIO_MIRROR=mirror.gcr.io` for the preloaded images |
| Boot test | `tools/images/boot-test.sh` (qemu, KVM) before anything is pushed |
| Scan + SBOM | Trivy/Grype on the image is of little use for a qcow2; `syft` over the mounted root filesystem (`virt-tar-out` / `guestmount`) for the SBOM, and a package-list diff against the previous release |
| Push | to `ghcr.io/<owner>/<repo>/<publishName>` with the catalog tag and `sha-<commit>`; cosign keyless signature, provenance and SBOM attestations as in `images.yml`; the digest as a `digest-<publishName>` artifact |
| Overlay | `images.yml`'s `catalog overlay` job then finds the digests (a `workflow_run` trigger, or one release workflow that calls both as reusable workflows), and `--allow-missing` stops listing containerDisks |

**Mirror-content images.** `el-vm` and `ubuntu-vm` carry the package-mirror snapshot
as a local repository (several GB), built by `tools/mirrors/build-content.sh` from the
pinned snapshot dates. Two options: (a) run `build-content.sh` in the job (slow,
tens of minutes, a lot of download), or (b) publish the mirror content once per snapshot
date as an OCI artifact (`oras push ghcr.io/<owner>/<repo>/mirror-content:<date>`) and
pull it into the job. Recommendation: (b), since the content changes only when the
snapshot dates in `deploy/versions.env` change.

**Size and cost.** GHCR storage and egress are free for public packages. For private
packages, storage counts against the plan's quota: ~10 variants x ~1-3 GB x retained
versions. A retention job keeps the last N `sha-*` versions per package and every
semver tag. Hosted runner minutes are free for public repositories; a private
repository pays per minute (about 10-25 minutes per variant).

**Licensing.** The images contain Ubuntu, AlmaLinux, Kubernetes, etcd, Docker Engine,
Calico and the add-on charts, all redistributable. Publishing must keep the SBOM and
licence texts (as the containers do). Anything restricted stays `publishable: false`,
and `labctl catalog check` would also cover `vm-images.yml` (pass `--workflow` twice
once it exists).

**Open points.** Whether GitHub keeps `/dev/kvm` on standard hosted runners (it is
documented for Android emulator use, not as a guarantee); the fallback is a self-hosted
runner on the verify VM with the same workflow. Signing qcow2 content beyond the OCI
signature (for vSphere imports later) is out of scope.
