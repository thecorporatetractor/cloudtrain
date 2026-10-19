#!/bin/bash
cd /srv/ct-work/dev/kata
source env.sh; kk delete ns kata-dbg --wait=false >/dev/null 2>&1
echo "# start $(date -Is) load: $(cut -d' ' -f1-3 /proc/loadavg)"
for rc in runc kata-clh kata-qemu-runtime-rs kata-qemu; do r=$rc; [[ $rc == runc ]] && r=-; ./lat.sh "sys-$rc" $r cloudtrain/deb-sys:spike 5 systemd; done
./vmlat.sh ubuntu-vm cloudtrain/ubuntu-vm:24.04 5
echo "# end $(date -Is) load: $(cut -d' ' -f1-3 /proc/loadavg)"
for rc in kata-clh kata-qemu-runtime-rs -; do ./probe.sh $rc; done > probe.txt 2>&1
echo "# probes done"
