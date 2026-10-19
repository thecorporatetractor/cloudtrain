#!/bin/bash
cd /srv/ct-work/dev/kata
echo "# start $(date -Is) load: $(cut -d' ' -f1-3 /proc/loadavg)"
for rc in runc kata-clh kata-qemu-runtime-rs kata-qemu kata-clh-runtime-rs kata-dragonball; do r=$rc; [[ $rc == runc ]] && r=-; ./lat.sh "bb-$rc" $r docker.io/library/busybox:1.37 8; done
for rc in runc kata-clh kata-qemu-runtime-rs; do r=$rc; [[ $rc == runc ]] && r=-; ./lat.sh "sys-$rc" $r cloudtrain/deb-sys:spike 5 systemd; done
./vmlat.sh ubuntu-vm cloudtrain/ubuntu-vm:24.04 5
echo "# end $(date -Is) load: $(cut -d' ' -f1-3 /proc/loadavg)"
