#!/bin/bash
# Host metrics every ${1:-10}s -> /srv/ct-work/results/metrics/YYYY-MM-DD.tsv
# columns: time  cpu_busy%  user%  sys%  iowait%  steal%  load1  mem_used_GiB  mem_avail_GiB  running_vmis  pods
out=/srv/ct-work/results/metrics; mkdir -p "$out"; iv=${1:-10}
read -r _ u n s i w q sq st _ < /proc/stat
while sleep "$iv"; do
  read -r _ u2 n2 s2 i2 w2 q2 sq2 st2 _ < /proc/stat
  tot=$(( (u2+n2+s2+i2+w2+q2+sq2+st2) - (u+n+s+i+w+q+sq+st) )); ((tot > 0)) || tot=1
  busy=$(( (u2+n2+s2+q2+sq2+st2) - (u+n+s+q+sq+st) ))
  f="$out/$(date -u +%F).tsv"
  [[ -f $f ]] || printf 'time\tcpu_busy\tuser\tsys\tiowait\tsteal\tload1\tmem_used_gib\tmem_avail_gib\tvmis\tpods\n' > "$f"
  read -r mt ma < <(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf "%.1f %.1f", (t-a)/1048576, a/1048576}' /proc/meminfo)
  vmis=$(kubectl --context kind-cloudtrain-dev get vmi -A --no-headers 2>/dev/null | wc -l)
  pods=$(kubectl --context kind-cloudtrain-dev get pods -A --no-headers 2>/dev/null | wc -l)
  awk -v t="$(date -u +%FT%TZ)" -v tot=$tot -v b=$busy -v us=$(( (u2+n2)-(u+n) )) -v sy=$(( (s2+q2+sq2)-(s+q+sq) )) -v io=$((w2-w)) -v stl=$((st2-st)) \
      -v l="$(cut -d' ' -f1 /proc/loadavg)" -v mt=$mt -v ma=$ma -v vm=$vmis -v p=$pods \
      'BEGIN{printf "%s\t%.1f\t%.1f\t%.1f\t%.1f\t%.2f\t%s\t%s\t%s\t%s\t%s\n", t, 100*b/tot, 100*us/tot, 100*sy/tot, 100*io/tot, 100*stl/tot, l, mt, ma, vm, p}' >> "$f"
  u=$u2 n=$n2 s=$s2 i=$i2 w=$w2 q=$q2 sq=$sq2 st=$st2
done
