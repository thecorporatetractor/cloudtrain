#!/bin/sh
# gate-test.sh: runs the learner's ci/plan.sh on two private copies of the stack with
# `iac apply` stubbed out (nothing is applied): the stack as it is (merge request !142)
# and the stack without the merge request. Prints mr142=<refused|applied> clean=<...>.
set -u
src=/home/learner/stacks/trading-data
run() { # run DIR -> refused|applied|error
  shim=$(runuser -u learner -- mktemp -d /tmp/ct-opa-shim.XXXXXX)
  printf '#!/bin/sh\nif [ "${1:-}" = apply ]; then echo CT-APPLY-CALLED; exit 0; fi\nexec /usr/local/bin/iac "$@"\n' > "$shim/iac"
  chmod 755 "$shim/iac"; chown -R learner:learner "$shim"
  out=$(runuser -u learner -- env -i HOME=/home/learner USER=learner LOGNAME=learner TERM=dumb \
    PATH="$shim:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" sh "$1/ci/plan.sh" 2>&1); rc=$?
  rm -rf "$shim"
  case "$out" in *CT-APPLY-CALLED*) echo applied ;; *) [ $rc -ne 0 ] && echo refused || echo error ;; esac
}
a=$(runuser -u learner -- mktemp -d /tmp/ct-opa-a.XXXXXX); b=$(runuser -u learner -- mktemp -d /tmp/ct-opa-b.XXXXXX)
runuser -u learner -- cp -a "$src/." "$a/"; runuser -u learner -- cp -a "$src/." "$b/"
rm -f "$b/mr-142.tf"
echo "mr142=$(run "$a") clean=$(run "$b")"
rm -rf "$a" "$b"
