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
      python3 iproute2 iputils-ping dnsutils netcat-openbsd tmux \
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
COPY --chmod=0755 iac ct-iac /usr/local/bin/
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

COPY terraformrc /etc/cloudtrain/terraformrc
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
 && . /etc/cloudtrain/iac.env \
 && printf 'CLOUDTRAIN_IMAGE=iac-ws\nIAC_CLI=%s\nTERRAFORM_VERSION=%s\nTOFU_VERSION=%s\nKUBECTL_VERSION=%s\nHELM_VERSION=%s\nYQ_VERSION=%s\n' \
      "$IAC_CLI" "$TERRAFORM_VERSION" "$TOFU_VERSION" "$KUBECTL_VERSION" "$HELM_VERSION" "$YQ_VERSION" > /etc/cloudtrain-release
ENV CHECKPOINT_DISABLE=1
USER learner
WORKDIR /home/learner
CMD ["sleep", "infinity"]
