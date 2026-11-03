# Mirrored execution environment base (localhost/ov-ee-base:1), baked as an image archive into
# el-vm:10 for ov-execution-environment-build. Built by tools/images/build-ee-base.sh; versions from
# deploy/versions.env, requirements.lock (sha256 per wheel) and collections.lock.
#
# ansible-builder's generated stages expect /usr/bin/python3 with ensurepip, /usr/bin/dnf, ansible-core and
# ansible-runner. Lab VMs have no PyPI, so pip reads only the wheelhouse (PIP_NO_INDEX, PIP_FIND_LINKS).
#
# Licences: ansible-core and community.general are GPL-3.0-or-later and run here as separate programs
# (CloudTrain code does not link them); the texts ship in /usr/share/doc/ansible-core and in the collection.
# checkov:skip=CKV_DOCKER_7: ALMA_BASE_IMAGE is pinned by digest in deploy/versions.env
ARG ALMA_BASE_IMAGE
FROM ${ALMA_BASE_IMAGE}
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG ALMA_REPO
ARG ANSIBLE_CORE_VERSION
RUN set -eux; rm -f /etc/yum.repos.d/*.repo; \
    for r in BaseOS AppStream; do \
      printf '[%s]\nname=AlmaLinux %s (point release)\nbaseurl=%s/%s/x86_64/os/\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10\n' \
        "$r" "$r" "$ALMA_REPO" "$r" >> /etc/yum.repos.d/build-alma.repo; done; \
    printf 'retries=10\ntimeout=30\n' >> /etc/dnf/dnf.conf; \
    dnf -y --setopt=install_weak_deps=False upgrade; \
    dnf -y --setopt=install_weak_deps=False install python3 python3-pip tar gzip findutils; \
    dnf clean all; rm -rf /var/cache/dnf /var/log/dnf* /etc/yum.repos.d/build-alma.repo
COPY requirements.lock collections.lock /opt/ee-base/
RUN set -eux; \
    python3 -m pip download --no-cache-dir --no-deps --only-binary=:all: --require-hashes -d /opt/wheelhouse -r /opt/ee-base/requirements.lock; \
    python3 -m pip install --no-cache-dir --no-index --find-links=/opt/wheelhouse "ansible-core==${ANSIBLE_CORE_VERSION}" "ansible-runner==$(sed -n 's/^ansible-runner==\([^ ]*\) .*/\1/p' /opt/ee-base/requirements.lock)"; \
    test "$(ansible --version | head -1)" = "ansible [core ${ANSIBLE_CORE_VERSION}]"; \
    ansible-runner --version; \
    if python3 -c 'import jmespath' 2>/dev/null; then echo 'jmespath must not be preinstalled: the lab adds it' >&2; exit 1; fi; \
    install -d /usr/share/doc/ansible-core; \
    cp /usr/local/lib/python3*/site-packages/ansible_core-*.dist-info/licenses/COPYING /usr/share/doc/ansible-core/COPYING; \
    cd /tmp; grep -v '^#' /opt/ee-base/collections.lock | grep . | while read -r file sha; do \
      curl --retry 5 --retry-connrefused -fsSLo "$file" "https://galaxy.ansible.com/api/v3/plugin/ansible/content/published/collections/artifacts/${file}"; \
      echo "${sha#sha256:}  ${file}" | sha256sum -c - >/dev/null; \
      ansible-galaxy collection install --offline --no-deps -p /usr/share/ansible/collections "./${file}" >/dev/null; \
      rm -f "$file"; \
    done; \
    rm -rf /usr/share/ansible/collections/ansible_collections/community/general/tests; \
    chmod -R a+rX /usr/share/ansible /opt/wheelhouse; \
    install -d -m 0775 -o 1000 -g 0 /runner; \
    printf 'CLOUDTRAIN_IMAGE=ov-ee-base\nANSIBLE_CORE_VERSION=%s\n' "$ANSIBLE_CORE_VERSION" > /etc/cloudtrain-release
ENV PIP_NO_INDEX=1 PIP_FIND_LINKS=/opt/wheelhouse PIP_DISABLE_PIP_VERSION_CHECK=1 HOME=/runner
WORKDIR /runner
# A build base, not a service. ansible-builder's generated stages switch to USER root themselves and end
# on USER 1000, the same user execution environments run as.
HEALTHCHECK NONE
USER 1000
CMD ["bash"]
