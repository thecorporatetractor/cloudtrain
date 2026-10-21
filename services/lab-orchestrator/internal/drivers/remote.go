package drivers

import (
	"context"
	"fmt"
	"strings"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// shellQuote quotes argv for a POSIX shell (ssh passes one command string).
func shellQuote(args []string) string {
	q := make([]string, len(args))
	for i, a := range args {
		q[i] = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
	}
	return strings.Join(q, " ")
}

// execOnHost runs req on a VM-backed host over ssh from the entry node:
// as admin from the admin sidecar (root on the host), as learner from the
// learner's shell (the learner's account on the host, with sudo).
func execOnHost(ctx context.Context, c *ContainerDriver, ref NodeRef, host string, req ExecRequest) (ExecResult, error) {
	if c == nil {
		return ExecResult{}, &NotImplementedError{Driver: ref.Node.Driver, Backend: "ssh", Op: "exec without entry node"}
	}
	if req.Kind != "" && req.Kind != ExecShell {
		return ExecResult{}, fmt.Errorf("host %s: exec kind %s: %w", host, req.Kind, ErrUnsupported)
	}
	if len(req.Command) == 0 {
		return ExecResult{}, fmt.Errorf("host %s: empty command", host)
	}
	r := req
	r.Kind, r.Member = ExecShell, ""
	r.Command = []string{"ssh", "-T", host, shellQuote(req.Command)}
	var res ExecResult
	var err error
	if req.User == labsv1.ActionAsLearner {
		res, err = c.LearnerExec(ctx, ref, r)
	} else {
		res, err = c.AdminExec(ctx, ref, r)
	}
	if err == nil && hostAccessFailed(res) {
		res.NoHostAccess = true
	}
	return res, err
}

// learnerContextScript runs "$@" with a private copy of the learner's
// kubeconfig switched to context $1, so learner actions target the right
// cluster without changing the learner's current-context.
const learnerContextScript = `t=$(mktemp) || exit 1
kubectl config view --raw > "$t" && KUBECONFIG="$t" kubectl config use-context "$1" >/dev/null || { rm -f "$t"; exit 1; }
shift
KUBECONFIG="$t" "$@"
rc=$?
rm -f "$t"
exit $rc`

// kubeApplyScript is `kubectl apply -f -` ("$@" is the kubectl command
// line) retried while the API server refuses a Pod because its namespace's
// default ServiceAccount does not exist yet: a manifest that creates a
// Namespace and a Pod in it races the ServiceAccount controller, which lags
// on a loaded cluster. apply is idempotent, so the whole manifest is applied
// again (up to about a minute).
const kubeApplyScript = `d=$(mktemp -d) || exit 1
cat > "$d/m"
i=0
while :; do
  "$@" -f "$d/m" > "$d/o" 2> "$d/e"; rc=$?
  i=$((i+1))
  if [ $rc -ne 0 ] && [ $i -lt 30 ] && grep -q 'error looking up service account' "$d/e"; then sleep 2; continue; fi
  break
done
cat "$d/o"; cat "$d/e" >&2
rm -rf "$d"
exit $rc`

// execOnCluster runs req against a cluster node's API from the entry node:
// admin with the cluster-admin kubeconfig in the admin sidecar, learner with
// the learner's kubeconfig (context cluster.context). ExecKubeApply applies
// Stdin with kubectl.
func execOnCluster(ctx context.Context, c *ContainerDriver, ref NodeRef, req ExecRequest) (ExecResult, error) {
	if c == nil {
		return ExecResult{}, &NotImplementedError{Driver: ref.Node.Driver, Backend: "kubectl", Op: "exec without entry node"}
	}
	cmd := req.Command
	switch req.Kind {
	case ExecKubeApply:
		cmd = []string{"/bin/sh", "-c", kubeApplyScript, "sh", "kubectl", "apply"}
	case ExecShell, "":
		if len(cmd) == 0 {
			return ExecResult{}, fmt.Errorf("cluster %s: empty command", ref.Node.Name)
		}
	default:
		return ExecResult{}, fmt.Errorf("cluster %s: exec kind %s: %w", ref.Node.Name, req.Kind, ErrUnsupported)
	}
	r := req
	r.Kind, r.Member = ExecShell, ""
	if req.User == labsv1.ActionAsLearner {
		context := ref.Node.Name
		if ref.Node.Cluster != nil && ref.Node.Cluster.Context != "" {
			context = ref.Node.Cluster.Context
		}
		r.Command = append([]string{"/bin/sh", "-c", learnerContextScript, "sh", context}, cmd...)
		return c.LearnerExec(ctx, ref, r)
	}
	r.Command = append([]string{"env", "KUBECONFIG=" + AdminKubeconfigPath(ref.Node.Name)}, cmd...)
	return c.AdminExec(ctx, ref, r)
}
