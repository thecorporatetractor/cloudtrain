#!/bin/bash
# kind-only fixes for Kata on ct-kata-worker (lost when the node container restarts):
#  - /dev/shm is 64M in a kind node; Kata QEMU (Go) backs guest RAM with a /dev/shm file for virtio-fs
#  - kind nodes have no D-Bus; runtime-rs shims move the VMM into the systemd cgroup over D-Bus
source /srv/ct-work/dev/kata/env.sh
docker exec ct-kata-worker sh -c 'mount -o remount,size=32G /dev/shm; command -v dbus-daemon >/dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends dbus) >/dev/null 2>&1; systemctl start dbus.socket dbus.service 2>/dev/null; test -S /run/dbus/system_bus_socket && echo dbus-ok; df -h /dev/shm | tail -1; ls -l /dev/vhost-vsock'
