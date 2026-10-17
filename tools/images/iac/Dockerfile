# IaC learner workstation ("learner@workstation"), catalog refs terraform-ws:1.15
# (IAC_CLI=terraform) and its OpenTofu flavour (IAC_CLI=tofu, see deploy/images/catalog.yaml).
# Built by tools/images/build-iac-ws.sh; every version and checksum comes from
# deploy/versions.env and providers.lock (sha256 per provider zip, taken from HashiCorp's
# signed SHA256SUMS by lock-providers.sh).
#
# IAC_CLI picks the primary binary:
#   terraform  Terraform (BUSL-1.1) as `terraform`, OpenTofu (MPL-2.0) alongside as `tofu`
#   tofu       OpenTofu only; no Terraform binary is downloaded or shipped, and
#              `terraform` is a shim that runs tofu (TERRAFORM_SHIM=0 leaves it out)
# Either way `iac` runs the primary binary and /etc/cloudtrain/iac.env records it; lab
# setup, checks and solutions call `iac` / `ct-iac`, never a hard-coded binary.
#
# Offline: providers install only from the filesystem mirror /opt/cloudtrain/providers
# (~/.terraformrc), reachable under both registry.terraform.io and registry.opentofu.org.
# State backends: `ct-s3` runs a local S3-compatible store (SeaweedFS) inside the pod.
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG UBUNTU_APT_SNAPSHOT
ARG KUBECTL_VERSION
ARG HELM_VERSION
ARG HELM_TARBALL_SHA256
ARG YQ_VERSION
ARG YQ_BINARY_SHA256
ARG TERRAFORM_VERSION
ARG TERRAFORM_ZIP_SHA256
ARG TOFU_VERSION
ARG TOFU_ZIP_SHA256
ARG SEAWEEDFS_VERSION
ARG SEAWEEDFS_TARBALL_SHA256
ARG TERRAFORM_STAGED_19_VERSION
ARG TERRAFORM_STAGED_19_ZIP_SHA256
ARG TERRAFORM_STAGED_15_VERSION
ARG TERRAFORM_STAGED_15_ZIP_SHA256
ARG TERRAFORM_STAGED_15_LICENSE_SHA256
ARG CONFTEST_VERSION
ARG CONFTEST_TARBALL_SHA256
ARG GOVMOMI_VERSION
ARG VCSIM_TARBALL_SHA256
ARG ORAS_VERSION
ARG ORAS_TARBALL_SHA256
ARG DISTRIBUTION_VERSION
ARG DISTRIBUTION_TARBALL_SHA256
ARG IAC_CLI=terraform
ARG TERRAFORM_SHIM=1
ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
      openssh-client bash-completion vim nano less curl jq tar gzip unzip git tree make \
      python3 iproute2 iputils-ping dnsutils netcat-openbsd tmux openssl systemd \
 && rm -rf /var/lib/apt/lists/*

# Kubernetes CLIs (kubectl: dl.k8s.io .sha256; helm, yq: pinned sha256).
RUN set -eu; cd /tmp \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
 && echo "$(curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256")  /usr/local/bin/kubectl" | sha256sum -c - \
 && curl -fsSLo helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
 && echo "${HELM_TARBALL_SHA256}  helm.tgz" | sha256sum -c - \
 && tar -xzf helm.tgz --strip-components=1 -C /usr/local/bin linux-amd64/helm \
 && curl -fsSLo /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64" \
 && echo "${YQ_BINARY_SHA256}  /usr/local/bin/yq" | sha256sum -c - \
 && rm -f helm.tgz && chmod 0755 /usr/local/bin/* \
 && C=/usr/share/bash-completion/completions \
 && kubectl completion bash > "$C/kubectl" && helm completion bash > "$C/helm" && yq shell-completion bash > "$C/yq"

# IaC CLIs. Licence texts stay next to each binary under /usr/share/doc.
RUN set -eu; cd /tmp \
 && case "$IAC_CLI" in terraform|tofu) ;; *) echo "IAC_CLI must be terraform or tofu" >&2; exit 1 ;; esac \
 && curl -fsSLo tofu.zip "https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}/tofu_${TOFU_VERSION}_linux_amd64.zip" \
 && echo "${TOFU_ZIP_SHA256}  tofu.zip" | sha256sum -c - \
 && unzip -q tofu.zip -d tofu.d && install -m 0755 tofu.d/tofu /usr/local/bin/tofu \
 && install -d /usr/share/doc/opentofu && install -m 0644 tofu.d/LICENSE /usr/share/doc/opentofu/LICENSE \
 && if [ "$IAC_CLI" = terraform ]; then \
      curl -fsSLo terraform.zip "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" \
      && echo "${TERRAFORM_ZIP_SHA256}  terraform.zip" | sha256sum -c - \
      && unzip -q terraform.zip -d terraform.d && install -m 0755 terraform.d/terraform /usr/local/bin/terraform \
      && install -d /usr/share/doc/terraform && install -m 0644 terraform.d/LICENSE.txt /usr/share/doc/terraform/LICENSE.txt; \
    fi \
 && rm -rf tofu.zip tofu.d terraform.zip terraform.d \
 && printf 'IAC_CLI=%s\nTERRAFORM_VERSION=%s\nTOFU_VERSION=%s\n' "$IAC_CLI" \
      "$([ "$IAC_CLI" = terraform ] && echo "$TERRAFORM_VERSION")" "$TOFU_VERSION" > /tmp/iac.env
# Local S3-compatible store for state-backend labs (SeaweedFS, Apache-2.0): see ct-s3.
RUN set -eu; cd /tmp \
 && curl -fsSLo weed.tgz "https://github.com/seaweedfs/seaweedfs/releases/download/${SEAWEEDFS_VERSION}/linux_amd64.tar.gz" \
 && echo "${SEAWEEDFS_TARBALL_SHA256}  weed.tgz" | sha256sum -c - \
 && tar -xzf weed.tgz -C /usr/local/bin weed && rm -f weed.tgz && chmod 0755 /usr/local/bin/weed \
 && weed version | head -1
# Older Terraform releases for upgrade/migration labs, never on PATH as `terraform`:
# terraform-1.9 (BUSL-1.1, Terraform flavour only) and terraform-1.5 (MPL-2.0, both).
RUN set -eu; cd /tmp; d=/opt/cloudtrain/terraform \
 && stage() { v=$1 sha=$2; curl -fsSLo tf.zip "https://releases.hashicorp.com/terraform/${v}/terraform_${v}_linux_amd64.zip" \
      && echo "${sha}  tf.zip" | sha256sum -c - && install -d "$d/$v" && unzip -q -o tf.zip -d "$d/$v" && rm -f tf.zip \
      && ln -s "$d/$v/terraform" "/usr/local/bin/terraform-${v%.*}"; } \
 && stage "$TERRAFORM_STAGED_15_VERSION" "$TERRAFORM_STAGED_15_ZIP_SHA256" \
 && curl -fsSLo "$d/$TERRAFORM_STAGED_15_VERSION/LICENSE" "https://raw.githubusercontent.com/hashicorp/terraform/v${TERRAFORM_STAGED_15_VERSION}/LICENSE" \
 && echo "${TERRAFORM_STAGED_15_LICENSE_SHA256}  $d/$TERRAFORM_STAGED_15_VERSION/LICENSE" | sha256sum -c - \
 && if [ "$IAC_CLI" = terraform ]; then stage "$TERRAFORM_STAGED_19_VERSION" "$TERRAFORM_STAGED_19_ZIP_SHA256"; fi \
 && chmod -R a+rX "$d" && terraform-1.5 version
# conftest (policy on plan JSON), vcsim (vSphere API simulator, ct-vcsim), oras and the
# distribution registry (OCI artifacts, ct-oci). Licences under /usr/share/doc/<tool>.
RUN set -eu; cd /tmp \
 && get() { curl -fsSLo "$1.tgz" "$2" && echo "$3  $1.tgz" | sha256sum -c - && install -d "$1.d" "/usr/share/doc/$1" \
      && tar -xzf "$1.tgz" -C "$1.d" && install -m 0755 "$1.d/$1" /usr/local/bin/ \
      && install -m 0644 "$1.d"/LICENSE* "/usr/share/doc/$1/" && rm -rf "$1.tgz" "$1.d"; } \
 && get conftest "https://github.com/open-policy-agent/conftest/releases/download/v${CONFTEST_VERSION}/conftest_${CONFTEST_VERSION}_Linux_x86_64.tar.gz" "$CONFTEST_TARBALL_SHA256" \
 && get vcsim "https://github.com/vmware/govmomi/releases/download/v${GOVMOMI_VERSION}/vcsim_Linux_x86_64.tar.gz" "$VCSIM_TARBALL_SHA256" \
 && get oras "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_linux_amd64.tar.gz" "$ORAS_TARBALL_SHA256" \
 && get registry "https://github.com/distribution/distribution/releases/download/v${DISTRIBUTION_VERSION}/registry_${DISTRIBUTION_VERSION}_linux_amd64.tar.gz" "$DISTRIBUTION_TARBALL_SHA256" \
 && conftest --version && oras version >/dev/null
# TLS for the in-pod OCI registry (OpenTofu fetches OCI artifacts over HTTPS only): a lab
# CA generated at build time, trusted system-wide; the registry serves 127.0.0.1/localhost.
RUN set -eu; d=/etc/cloudtrain/oci-tls; install -d "$d"; cd "$d" \
 && openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=CloudTrain lab registry CA" -keyout ca.key -out ca.crt 2>/dev/null \
 && openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout tls.key -out tls.csr 2>/dev/null \
 && printf 'subjectAltName=DNS:localhost,DNS:registry.saltmarsh.lab,IP:127.0.0.1\n' > ext.cnf \
 && openssl x509 -req -in tls.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 3650 -extfile ext.cnf -out tls.crt 2>/dev/null \
 && rm -f ca.key ca.srl tls.csr ext.cnf && chmod 0644 ./* \
 && cp ca.crt /usr/local/share/ca-certificates/cloudtrain-lab-registry.crt && update-ca-certificates >/dev/null
COPY --chmod=0755 iac ct-iac ct-s3 ct-vcsim ct-oci /usr/local/bin/
COPY --chmod=0755 terraform-shim /usr/local/lib/cloudtrain/terraform-shim
RUN install -d /etc/cloudtrain && mv /tmp/iac.env /etc/cloudtrain/iac.env \
 && if [ "$IAC_CLI" = tofu ] && [ "$TERRAFORM_SHIM" = 1 ]; then ln -s /usr/local/lib/cloudtrain/terraform-shim /usr/local/bin/terraform; fi \
 && iac version && tofu version

# Offline provider mirror: linux_amd64 unpacked (init symlinks it into .terraform),
# other platforms packed, for `providers lock -platform=...`. registry.opentofu.org is a
# hard-linked copy (no extra space), so `hashicorp/x` resolves offline under both CLIs.
COPY providers.lock /opt/cloudtrain/providers.lock
RUN set -eu; m=/opt/cloudtrain/providers/registry.terraform.io; cd /tmp \
 && grep -v '^#' /opt/cloudtrain/providers.lock | grep . | while read -r addr version platform sha; do \
      type=${addr#*/}; zip="terraform-provider-${type}_${version}_${platform}.zip"; \
      curl -fsSLo "$zip" "https://releases.hashicorp.com/terraform-provider-${type}/${version}/${zip}"; \
      echo "${sha}  ${zip}" | sha256sum -c - >/dev/null; \
      if [ "$platform" = linux_amd64 ]; then \
        install -d "$m/$addr/$version/$platform"; unzip -q -o "$zip" -d "$m/$addr/$version/$platform"; \
      else \
        install -d "$m/$addr"; mv "$zip" "$m/$addr/$zip"; \
      fi; \
      rm -f "$zip"; \
    done \
 && cp -al /opt/cloudtrain/providers/registry.terraform.io /opt/cloudtrain/providers/registry.opentofu.org \
 && chmod -R a+rX /opt/cloudtrain

COPY terraformrc s3.json /etc/cloudtrain/
COPY aws-credentials aws-config /etc/cloudtrain/aws/
COPY bashrc /etc/cloudtrain/bashrc
COPY vimrc /etc/vim/vimrc.local
# Non-root learner (uid/gid 1000, what the runtime's securityContext uses); the ubuntu
# base user also has uid 1000, so it goes. root gets the same CLI config for setup.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -U -s /bin/bash learner \
 && echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' | tee -a /etc/skel/.bashrc >> /home/learner/.bashrc \
 && install -d -m 0700 -o learner -g learner /home/learner/.ssh /home/learner/.kube \
 && install -m 0644 -o learner -g learner /etc/cloudtrain/terraformrc /home/learner/.terraformrc \
 && install -m 0644 /etc/cloudtrain/terraformrc /etc/skel/.terraformrc \
 && install -m 0644 /etc/cloudtrain/terraformrc /root/.terraformrc \
 && install -d -m 0700 -o learner -g learner /home/learner/.aws \
 && install -m 0600 -o learner -g learner /etc/cloudtrain/aws/aws-credentials /home/learner/.aws/credentials \
 && install -m 0644 -o learner -g learner /etc/cloudtrain/aws/aws-config /home/learner/.aws/config \
 && . /etc/cloudtrain/iac.env \
 && printf 'CLOUDTRAIN_IMAGE=iac-ws\nIAC_CLI=%s\nTERRAFORM_VERSION=%s\nTOFU_VERSION=%s\nKUBECTL_VERSION=%s\nHELM_VERSION=%s\nYQ_VERSION=%s\n' \
      "$IAC_CLI" "$TERRAFORM_VERSION" "$TOFU_VERSION" "$KUBECTL_VERSION" "$HELM_VERSION" "$YQ_VERSION" > /etc/cloudtrain-release
ENV CHECKPOINT_DISABLE=1
USER learner
WORKDIR /home/learner
CMD ["sleep", "infinity"]
