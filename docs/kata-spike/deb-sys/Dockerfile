# Spike only (docs/kata-spike.md): tier-B "deb-sys" = deb-lab:24.04 + systemd as PID 1.
# Packages from the Ubuntu archive here; a real build would use the noble mirror snapshot.
FROM cloudtrain/deb-lab:24.04
ENV DEBIAN_FRONTEND=noninteractive container=other
RUN set -eux; mkdir -p /tmp/apt-off; mv /etc/apt/sources.list.d/* /tmp/apt-off/ 2>/dev/null || true; \
    printf 'Types: deb\nURIs: http://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' > /etc/apt/sources.list.d/build.sources; \
    apt-get update; apt-get install -y --no-install-recommends systemd systemd-sysv dbus libpam-systemd openssh-server chrony nftables iptables lvm2 mdadm dmsetup kmod; \
    rm -f /etc/apt/sources.list.d/build.sources; mv /tmp/apt-off/* /etc/apt/sources.list.d/ 2>/dev/null || true; \
    apt-get clean; rm -rf /var/lib/apt/lists/*; \
    systemctl mask systemd-udevd.service systemd-udev-trigger.service getty.target console-getty.service systemd-logind.service 2>/dev/null || true; \
    systemctl enable ssh.service; \
    echo 'learner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-learner; chmod 0440 /etc/sudoers.d/90-learner; usermod -U learner || true; \
    printf '[Service]\nExecStartPre=/usr/bin/ssh-keygen -A\n' > /tmp/x; mkdir -p /etc/systemd/system/ssh.service.d; mv /tmp/x /etc/systemd/system/ssh.service.d/10-hostkeys.conf
COPY ct-sysinit /usr/local/sbin/ct-sysinit
STOPSIGNAL SIGRTMIN+3
# readiness comes from the orchestrator (systemctl is-system-running probe)
HEALTHCHECK NONE
ENTRYPOINT ["/usr/local/sbin/ct-sysinit"]
CMD []
