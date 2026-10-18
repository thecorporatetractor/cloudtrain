# Ansible control node ("learner@ov-ctl"), catalog ref ansible-ctl:2.21. Built by
# tools/images/build-ansible-ctl.sh; every version and checksum comes from deploy/versions.env,
# requirements.lock (sha256 per wheel) and collections.lock (sha256 per collection tarball,
# the same artifacts the offline mirror serves under /ansible/).
#
# Contents: ansible-core, ansible-navigator (execution environments disabled by the labs:
# there is no container engine in the pod), ansible-lint, Molecule, ansible-builder (via
# navigator), yamllint, the mirrored collections in /usr/share/ansible/collections, sshpass
# (password bootstrap labs), git, vim and nano. Grading helper: ct-ansible. Lab network
# helper (root, setup only): ct-fleet-net.
#
# Licences: ansible-core is GPL-3.0-or-later and runs here as a separate program (CloudTrain
# code does not link it); its licence text ships in the venv's dist-info and under
# /usr/share/doc/ansible-core. See docs/handoffs/automation.md "Licence gate".
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG UBUNTU_APT_SNAPSHOT
ARG ANSIBLE_CORE_VERSION
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
      python3 python3-venv openssh-client sshpass git bash-completion vim nano less curl jq tree \
      make rsync tar gzip bzip2 unzip file iproute2 iputils-ping dnsutils netcat-openbsd tmux \
 && rm -rf /var/lib/apt/lists/*

# Python tools in one venv, wheels only, every file hash-checked (pip --require-hashes).
COPY requirements.lock /opt/ansible/requirements.lock
RUN python3 -m venv /opt/ansible \
 && /opt/ansible/bin/pip install --no-cache-dir --no-deps --only-binary=:all: --require-hashes \
      -r /opt/ansible/requirements.lock \
 && /opt/ansible/bin/pip check \
 && for b in ansible ansible-config ansible-console ansible-doc ansible-galaxy ansible-inventory \
             ansible-playbook ansible-pull ansible-vault ansible-test ansible-navigator \
             ansible-builder ansible-runner yamllint; do ln -s "/opt/ansible/bin/$b" "/usr/local/bin/$b"; done \
 && for b in ansible-lint molecule; do rm -f "/usr/local/bin/$b"; \
      printf '#!/bin/sh\n# venv tool: run it with the venv first on PATH (it warns otherwise)\nPATH=/opt/ansible/bin:$PATH exec /opt/ansible/bin/%s "$@"\n' "$b" > "/usr/local/bin/$b"; \
      chmod 0755 "/usr/local/bin/$b"; done \
 && test "$(ansible --version | head -1)" = "ansible [core ${ANSIBLE_CORE_VERSION}]" \
 && install -d /usr/share/doc/ansible-core \
 && cp /opt/ansible/lib/python3*/site-packages/ansible_core-*.dist-info/licenses/COPYING /usr/share/doc/ansible-core/COPYING

# Collections from collections.lock (Galaxy artifacts, sha256 = the mirror's ansible.lock).
COPY collections.lock /opt/ansible/collections.lock
RUN set -eu; cd /tmp; c=/usr/share/ansible/collections \
 && grep -v '^#' /opt/ansible/collections.lock | grep . | while read -r file sha; do \
      curl -fsSLo "$file" "https://galaxy.ansible.com/api/v3/plugin/ansible/content/published/collections/artifacts/${file}"; \
      echo "${sha#sha256:}  ${file}" | sha256sum -c - >/dev/null; \
      ansible-galaxy collection install --offline --no-deps -p "$c" "./${file}" >/dev/null; \
      rm -f "$file"; \
    done \
 && chmod -R a+rX /usr/share/ansible \
 && ansible-galaxy collection list -p "$c" --format yaml >/dev/null

COPY --chmod=0755 ct-ansible /usr/local/bin/ct-ansible
COPY --chmod=0755 ct-fleet-net /usr/local/sbin/ct-fleet-net
COPY bashrc /etc/cloudtrain/bashrc
COPY vimrc /etc/vim/vimrc.local
# Non-root learner (uid/gid 1000, what the runtime's securityContext uses); the ubuntu base
# user also has uid 1000, so it goes.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -U -s /bin/bash learner \
 && echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' | tee -a /etc/skel/.bashrc /root/.bashrc >> /home/learner/.bashrc \
 && install -d -m 0700 -o learner -g learner /home/learner/.ssh /home/learner/.ansible \
 && ansible-config init --disabled -t all > /etc/cloudtrain/ansible.cfg.example \
 && printf 'CLOUDTRAIN_IMAGE=ansible-ctl\nANSIBLE_CORE_VERSION=%s\n' "$ANSIBLE_CORE_VERSION" > /etc/cloudtrain-release \
 && /opt/ansible/bin/pip freeze --all | sed 's/^/PY: /' >> /etc/cloudtrain-release \
 && ansible-galaxy collection list -p /usr/share/ansible/collections 2>/dev/null | awk '$1 ~ /\./ {print "COLLECTION: "$1" "$2}' >> /etc/cloudtrain-release
ENV ANSIBLE_FORCE_COLOR=0 PY_COLORS=0
# A lab workstation that only sleeps: Kubernetes ignores image health checks, the pod is
# ready when it runs.
HEALTHCHECK NONE
USER learner
WORKDIR /home/learner
CMD ["sleep", "infinity"]
