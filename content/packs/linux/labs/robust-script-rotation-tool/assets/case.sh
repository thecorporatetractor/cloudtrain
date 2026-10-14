#!/bin/bash
# Grader harness: run the learner's tool and the reference on the same fixture and
# compare exit status class and the resulting directory tree.
#   case.sh N  (cases are defined below)
n=$1; L=/var/lib/cloudtrain; tool=/home/learner/bin/rotate-roster.sh
[ -x "$tool" ] || { echo "fail: not executable"; exit 0; }
fixture() { # fixture DIR KIND
  mkdir -p "$1"
  case $2 in
    bad) printf 'duty,crew\nD1,Ada\nD2,\nD3,Cleo\nD4,Dev\n' > "$1/current.csv" ;;
    *) printf 'duty,crew\nD1,Ada\nD2,Bram\nD3,Cleo\nD4,Dev\nD5,Eli\n' > "$1/current.csv" ;;
  esac
  [ "$2" = noarchive ] || mkdir -p "$1/archive"
  [ "$2" = old ] && printf 'duty,crew\nD1,Old\n' > "$1/archive/roster-2026-W41.csv"
  chown -R learner:learner "$1"; chmod -R u+rwX,go+rX "$1"
}
tree() { (cd "$1" && find . -mindepth 1 -printf '%y %P\n' | sort; find . -type f -exec sha256sum {} + | sort -k2); }
run() { # run TOOL ARGS... as the learner -> prints rc
  (cd /tmp && timeout 20 runuser -u learner -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/learner "$@" >/tmp/.rr.out 2>/dev/null); echo $?
}
runref() { # the reference runs as root (the learner must not read it)
  (cd /tmp && timeout 20 env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/root "$@" >/dev/null 2>&1); echo $?
}
base=$(mktemp -d /tmp/rr.XXXXXX); chmod 0755 "$base"
A="$base/learner/depot rosters"; R="$base/ref/depot rosters"
kind=plain; args=(-w 2026-W42); twice=0; helpcase=0
case $n in
  1) ;;                                   # normal run
  2) twice=1 ;;                           # a second run changes nothing
  3) args=(-w 2026-W42 -n 3) ;;           # shift 3
  4) args=(-x) ;;                         # unknown option
  5) args=(-w 2026-W42 -nodir) ;;         # -d missing (handled below)
  6) kind=bad ;;                          # crewshift fails half-way
  7) kind=noarchive ;;                    # archive directory missing
  8) kind=old; args=(-w 2026-W41) ;;      # week already archived
  9) helpcase=1 ;;
esac
fixture "$A" $kind; fixture "$R" $kind
argsfor() { if [ "$n" = 5 ]; then echo -w; echo 2026-W42; elif [ "$helpcase" = 1 ]; then echo -h; else echo -d; echo "$1"; printf '%s\n' "${args[@]}"; fi; }
mapfile -t la < <(argsfor "$A"); mapfile -t ra < <(argsfor "$R")
lrc=$(run "$tool" "${la[@]}"); lout=$(cat /tmp/.rr.out)
rrc=$(runref "$L/reference.sh" "${ra[@]}")
if [ $twice = 1 ]; then lrc=$(run "$tool" "${la[@]}"); rrc=$(runref "$L/reference.sh" "${ra[@]}"); fi
cls() { [ "$1" = 0 ] && echo ok || { [ "$1" = 2 ] && echo usage || echo error; }; }
verdict=pass
[ "$(cls $lrc)" = "$(cls $rrc)" ] || verdict="fail: exit $lrc, expected class $(cls $rrc)"
if [ "$verdict" = pass ] && [ "$(tree "$A")" != "$(tree "$R")" ]; then verdict="fail: directory differs"; fi
if [ "$verdict" = pass ] && [ $helpcase = 1 ] && ! printf '%s' "$lout" | grep -qi usage; then verdict="fail: no usage text on stdout"; fi
echo "$verdict"
rm -rf "$base" /tmp/.rr.out
