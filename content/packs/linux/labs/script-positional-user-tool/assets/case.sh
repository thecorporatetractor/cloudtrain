#!/bin/bash
# Grader harness: run the learner's mkcrew as root (account administration needs root)
# against hidden case N and compare exit status and resulting account state.
n=$1; tool=/usr/local/sbin/mkcrew
[ -x "$tool" ] || { echo "fail: not executable"; exit 0; }
run() { (cd /tmp && timeout 20 env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$tool" "$@" >/tmp/.mk.out 2>/tmp/.mk.err); echo $?; }
clean() { for u in "$@"; do userdel -r "$u" >/dev/null 2>&1; done; }
v=pass
case $n in
  1) # new user, existing group
     clean crw-ana; rc=$(run crw-ana drivers)
     [ "$rc" = 0 ] && id -nG crw-ana 2>/dev/null | grep -qw drivers && [ -d /home/crw-ana ] || v="fail: rc=$rc $(id crw-ana 2>&1)" ;;
  2) # user exists already: untouched, exit 0
     clean crw-ben; useradd -m -c "Ben original" crw-ben; before=$(getent passwd crw-ben)
     rc=$(run crw-ben drivers)
     [ "$rc" = 0 ] && [ "$(getent passwd crw-ben)" = "$before" ] || v="fail: rc=$rc" ;;
  3) # wrong number of arguments
     rc=$(run onlyone); [ "$rc" = 1 ] && grep -qi usage /tmp/.mk.err || v="fail: rc=$rc"
     [ "$v" = pass ] && { rc=$(run a b c); [ "$rc" = 1 ] || v="fail: 3 args rc=$rc"; }
     [ "$v" = pass ] && { rc=$(run); [ "$rc" = 1 ] || v="fail: 0 args rc=$rc"; }
     id onlyone >/dev/null 2>&1 && v="fail: created a user" ;;
  4) # group missing: created, user added
     clean crw-cai; groupdel guards-night 2>/dev/null; rc=$(run crw-cai guards-night)
     [ "$rc" = 0 ] && id -nG crw-cai 2>/dev/null | grep -qw guards-night || v="fail: rc=$rc" ;;
esac
echo "$v"
