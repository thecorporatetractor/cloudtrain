#!/bin/bash
cd /srv/ct-work/dev/kata
echo "# start $(date -Is) load: $(cut -d' ' -f1-3 /proc/loadavg)"
./mem.sh bb-runc - docker.io/library/busybox:1.37 20
for rc in kata-clh kata-clh-runtime-rs kata-qemu-runtime-rs kata-qemu; do ./mem.sh bb-$rc $rc docker.io/library/busybox:1.37 20; done
./mem.sh sys-runc - cloudtrain/deb-sys:spike 10 systemd
./mem.sh sys-kata-clh kata-clh cloudtrain/deb-sys:spike 10 systemd
./mem.sh sys-kata-qemu-runtime-rs kata-qemu-runtime-rs cloudtrain/deb-sys:spike 10 systemd
./mem.sh vmi-ubuntu vmi cloudtrain/ubuntu-vm:24.04 10
echo "# end $(date -Is) load: $(cut -d' ' -f1-3 /proc/loadavg)"
