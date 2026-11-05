package controller

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// Condition reasons for access revocation.
const (
	ReasonAccessRevoked  = "AccessRevoked"
	ReasonRevokePending  = "RevokePending"
	ReasonAccessGranted  = "AccessGranted"
	revokeActionTimeoutS = 30
)

// RevokeScript ends everything the learner runs or started (open shells, ssh
// clients, background jobs, and what they started through sudo). It runs as
// root on the entry node and on every VM node; the account itself stays
// (grading runs some checks as the learner). A process is the learner's when
// it runs as the learner's uid, belongs to one of the learner's login
// sessions (/proc/<pid>/loginuid survives sudo and setsid), or descends from
// such a process.
//
// Order matters. Nothing is killed until the whole tree is known: the
// learner's processes are first stopped (SIGSTOP), three rounds, so none can
// fork any more and every child keeps its parent; only then is the tree
// walked once more and killed. Killing first would re-parent a root child of
// a learner shell (`sudo nohup loop &`) to PID 1 before the walk, and where
// no loginuid is set (kubectl exec, runuser) nothing would find it again.
// The learner's systemd user manager goes last, which stops their user
// timers.
//
// Two kinds of the learner's processes are kept, because they are often the
// graded end state: containers (a systemd container scope such as
// machine.slice/libpod-<id>.scope or libpod-conmon-<id>.scope: `sudo podman
// run -d` leaves the learner's loginuid on conmon and the container), and
// processes running as an account other than the learner or root (`sudo -u
// svc nohup job &`, rootless podman as a service account). The second kind
// is reported: "cloudtrain-revoke: kept: <comm>[<pid>] uid=<uid>".
//
// Cron and at are left running on purpose: what the learner scheduled there
// is often the graded end state. So are system units the learner started
// through sudo (systemctl start, systemd-run), containers and daemons: they
// may be the graded state too. Instead, what may change state during grading
// is reported on stdout so an exam attempt is flagged for review:
//   - units that became active after the session was Ready and are either
//     transient (systemd-run, sudo systemd-run --scope) or defined by a unit
//     file or drop-in changed after Ready (a unit the learner wrote and
//     started with systemctl): "cloudtrain-revoke: still running: <unit>";
//   - processes started after Ready that are still alive a second after the
//     kill pass and that no systemd unit owns. On a systemd host: a process
//     in no *.service or non-session *.scope cgroup, or one re-parented to
//     PID 1 inside a *.service (other than an active service's main process)
//     or inside a container scope (other than conmon or a containerd shim),
//     which is where `echo $pid > .../cron.service/cgroup.procs` leaves a
//     daemonised loop. Without systemd, as in a kubectl-exec entry
//     container: anything whose ancestry ends at PID 1, i.e. was daemonised,
//     rather than at an exec from outside the container. Reported as
//     "cloudtrain-revoke: new process: <comm>[<pid>] <cgroup>". This catches
//     what the tree walk cannot see, e.g. `sudo setsid -f sh -c 'while :; do
//     ...; done'` from a shell without a loginuid, or after the learner
//     rewrote /proc/self/loginuid as root (VMs and kubeadm nodes make
//     loginuid immutable on every boot, see drivers.LoginuidImmutable; the
//     controller checks that on them, see revokeLoginuidCheck).
//
// Not detected: learner-started containers, cron/at jobs, a unit file
// changed before Ready and restarted after it, and vcluster workloads.
//
// %d is the number of seconds since the session became Ready (-1: unknown,
// no report).
const RevokeScript = `u=learner
since=%d
id "$u" >/dev/null 2>&1 || exit 0
uid=$(id -u "$u")
tree() {
  for d in /proc/[0-9]*; do
    cg=$(awk -F: '$1 == "0" || $2 ~ /name=systemd/ {print $3; exit}' "$d/cgroup" 2>/dev/null)
    awk -v p="${d#/proc/}" -v lu="$(cat "$d/loginuid" 2>/dev/null)" -v cg="${cg:-?}" \
      '/^PPid:/{pp=$2} /^Uid:/{own=$2} END{gsub(/[[:space:]]/, "_", cg); if (pp != "") print p, pp, own, lu, cg}' "$d/status" 2>/dev/null
  done | awk -v uid="$uid" -v self="$$" -v mode="$1" '` + revokeTreeAwk + `'
}
for round in 1 2 3; do tree kill | xargs -r kill -STOP 2>/dev/null; done
kept=$(tree keep)
tree kill | xargs -r kill -KILL 2>/dev/null
pkill -KILL -u "$u" 2>/dev/null
if command -v loginctl >/dev/null 2>&1; then loginctl terminate-user "$u" >/dev/null 2>&1; fi
for p in $kept; do
  [ -r "/proc/$p/status" ] || continue
  c=$(head -c 32 "/proc/$p/comm" 2>/dev/null | tr -d '\n' | tr -c 'A-Za-z0-9._/@:-' '_')
  o=$(awk '/^Uid:/{print $2}' "/proc/$p/status" 2>/dev/null)
  echo "` + revokeKept + `${c:-?}[$p] uid=${o:-?}"
done
mains=" "
if [ "$since" -ge 0 ] && [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  ref=$(( ($(cut -d. -f1 /proc/uptime) - since) * 1000000 ))
  wref=$(( $(date +%%s) - since ))
  systemctl list-units --plain --no-legend --no-pager --type=service,scope,timer --state=active 2>/dev/null | awk '{print $1}' | while read -r unit; do
    case $unit in session-*.scope|user@*.service|init.scope|docker-*.scope|cri-containerd-*.scope|crio-*.scope|libpod-*.scope) continue ;; esac
    t=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$unit" 2>/dev/null)
    [ "${t:-0}" -gt "$ref" ] 2>/dev/null || continue
    if [ "$(systemctl show -p Transient --value "$unit" 2>/dev/null)" = yes ]; then echo "` + revokeStillRunning + `$unit"; continue; fi
    for f in $(systemctl show -p FragmentPath -p DropInPaths --value "$unit" 2>/dev/null); do
      [ "$(stat -c %%Z "$f" 2>/dev/null || echo 0)" -ge "$wref" ] 2>/dev/null && { echo "` + revokeStillRunning + `$unit (unit file changed after Ready)"; break; }
    done
  done
  mains=" $(systemctl show -p MainPID --value $(systemctl list-units --plain --no-legend --no-pager --type=service --state=active 2>/dev/null | awk '{print $1}') 2>/dev/null | tr '\n' ' ') "
fi
if [ "$since" -ge 0 ]; then
  hz=$(getconf CLK_TCK 2>/dev/null || echo 100)
  rt=$(( ($(cut -d. -f1 /proc/uptime) - since) * hz ))
  sd=0; [ -d /run/systemd/system ] && sd=1
  procs() {
    for d in /proc/[0-9]*; do
      cg=$(awk -F: '$1 == "0" || $2 ~ /name=systemd/ {print $3; exit}' "$d/cgroup" 2>/dev/null)
      awk -v p="${d#/proc/}" -v cg="${cg:-?}" '{gsub(/[[:space:]]/, "_", cg); c = $0; sub(/^[^(]*\(/, "", c); sub(/\)[^)]*$/, "", c); s = $0; sub(/^.*\) /, "", s); split(s, f, " "); print p, f[2], f[20], cg, c}' "$d/stat" 2>/dev/null
    done | awk -v self="$$" -v rt="$rt" -v sd="$sd" -v mains="$mains" '` + revokeNewAwk + `'
  }
  first=$(procs); sleep 1
  procs | while read -r line; do
    case "
$first
" in *"
$line
"*) echo "` + revokeNewProcess + `$line" ;; esac
  done
fi
exit 0`

// revokeStillRunning prefixes each transient unit the revoke script reports.
const revokeStillRunning = "cloudtrain-revoke: still running: "

// revokeNewProcess prefixes each process started after Ready, outside any
// systemd unit, that survived the kill pass.
const revokeNewProcess = "cloudtrain-revoke: new process: "

// revokeLoginuid is reported by a VM or kubeadm node whose loginuids are not
// immutable: the boot-time lock (drivers.LoginuidImmutable) did not take
// effect, so root could have rewritten /proc/self/loginuid to hide a process
// from the tree walk.
const revokeLoginuid = "cloudtrain-revoke: loginuid not locked"

// revokeLoginuidCheck runs after RevokeScript on VM targets only (the
// controller knows the node kind; nothing in the guest decides whether the
// check runs). It asks the kernel, not auditctl (a binary root may have
// replaced): a subshell of the freeze shell tries to change its own
// loginuid, which fails with EPERM only when loginuids are immutable. The
// first write sets an unset loginuid (always allowed), the second tries to
// change it.
const revokeLoginuidCheck = `if [ ! -e /proc/self/loginuid ]; then echo "` + revokeLoginuid + ` (state unreadable)"
elif (echo 0 > /proc/self/loginuid; echo 4294967295 > /proc/self/loginuid) 2>/dev/null; then echo "` + revokeLoginuid + `"
fi
`

// revokeKept prefixes each learner process the freeze kept because it runs
// as another account (see RevokeScript).
const revokeKept = "cloudtrain-revoke: kept: "

// revokeContainerScope matches a cgroup path inside a container's systemd
// scope (podman, conmon, docker, containerd, CRI-O) below a slice.
const revokeContainerScope = `/[.]slice\/(libpod|libpod-conmon|docker|cri-containerd|crio|crio-conmon)-[0-9a-f]+[.]scope(\/|$)/`

// revokeNewAwk reads "pid ppid starttime cgroup comm" lines (starttime in
// clock ticks since boot) and prints "comm[pid] cgroup" for every process
// started after Ready (rt) that is not the revoke script, one of its
// ancestors or a kernel thread, and that no systemd unit owns. With systemd
// (sd=1): no component of its cgroup path is a *.service or a non-session
// *.scope (sub-cgroups of a unit, e.g. systemd-udevd.service/udev, belong to
// it) and it is not in the revoke script's own session; or it was
// re-parented to PID 1 inside a *.service without being the main process of
// an active service (mains: " pid pid ... "), or inside a container scope
// without being conmon or a containerd shim. That is where moving a
// daemonised loop into a unit's cgroup.procs leaves it. Without systemd: its
// ancestry ends at PID 1 (daemonised inside the node) rather than at an exec
// from outside (ppid 0). comm and cgroup are learner-controlled: anything
// but [A-Za-z0-9._/@:-] is replaced and both are truncated.
const revokeNewAwk = `
    { pp[$1] = $2; st[$1] = $3; cg[$1] = $4; c = $5; for (i = 6; i <= NF; i++) c = c "_" $i; cm[$1] = c }
    END {
      for (q = self; q != "" && q != 0 && !(q in anc); q = pp[q]) anc[q] = 1
      for (p in pp) {
        if (p == 1 || p == 2 || pp[p] == 2 || (p in anc) || st[p] + 0 <= rt + 0) continue
        if (sd == 1) {
          if (cg[p] == cg[self]) continue
          n = split(cg[p], parts, "/"); unit = ""
          for (i = 1; i <= n; i++) if (parts[i] ~ /[.](service|scope)$/ && parts[i] !~ /^session-/) unit = parts[i]
          if (unit != "") {
            if (pp[p] != 1 || index(mains, " " p " ") || cm[p] ~ /^(conmon|containerd-shim)/) continue
            if (unit ~ /[.]scope$/ && cg[p] !~ ` + revokeContainerScope + `) continue
          }
        } else {
          q = p; hops = 0
          while (q != 1 && (q in pp) && pp[q] != 0 && hops++ < 4096) q = pp[q]
          if (q != 1) continue
        }
        name = cm[p]; gsub(/[^A-Za-z0-9._\/@:-]/, "_", name)
        g = cg[p]; gsub(/[^A-Za-z0-9._\/@:-]/, "_", g)
        print substr(name, 1, 32) "[" p "] " substr(g, 1, 120)
      }
    }`

// revokeScript renders RevokeScript for a session.
func revokeScript(s *labsv1.LabSession, now time.Time) string {
	since := -1
	if s.Status.ReadyAt != nil && !now.Before(s.Status.ReadyAt.Time) {
		since = int(now.Sub(s.Status.ReadyAt.Time) / time.Second)
	}
	return fmt.Sprintf(RevokeScript, since)
}

// stillRunning extracts what a revoke run reported, as "node: unit" and
// "node: process comm[pid] cgroup".
func stillRunning(node, stdout string) []string {
	var out []string
	for _, l := range strings.Split(stdout, "\n") {
		l = strings.TrimSpace(l)
		if u, ok := strings.CutPrefix(l, revokeStillRunning); ok && u != "" {
			out = append(out, node+": "+u)
		} else if p, ok := strings.CutPrefix(l, revokeNewProcess); ok && p != "" {
			out = append(out, node+": process "+p)
		} else if p, ok := strings.CutPrefix(l, revokeKept); ok && p != "" {
			out = append(out, node+": kept "+p)
		} else if d, ok := strings.CutPrefix(l, revokeLoginuid); ok {
			out = append(out, node+": loginuid not locked"+d+" (the boot-time lock did not take effect; root could leave the learner's login session)")
		}
	}
	return out
}

// revokeTreeAwk reads "pid ppid uid loginuid cgroup" lines and finds the
// learner's processes (uid or loginuid = uid) and all their descendants,
// never self (the revoke script) or 1. mode=kill prints those to end,
// mode=keep those kept as graded state that is reported: processes running
// as neither the learner nor root. Processes in a container scope are kept
// and not reported.
const revokeTreeAwk = `
    { pp[$1] = $2; own[$1] = $3; cg[$1] = $5; if ($3 == uid || $4 == uid) mark[$1] = 1 }
    END {
      do { more = 0; for (p in pp) if (!(p in mark) && (pp[p] in mark)) { mark[p] = 1; more = 1 } } while (more)
      for (p in mark) {
        if (p == self || p == 1) continue
        ctr = cg[p] ~ ` + revokeContainerScope + `
        other = own[p] != uid && own[p] != 0
        if (mode == "kill" && !ctr && !other) print p
        if (mode == "keep" && !ctr && other) print p
      }
    }`

// accessRevoked reports whether the session is (or must be) frozen for the
// learner. Revocation is sticky: once the condition is True, clearing
// spec.accessRevoked does not restore access.
func accessRevoked(s *labsv1.LabSession) bool {
	return s.Spec.AccessRevoked || meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionAccessRevoked)
}

// revokeTargets are the nodes whose learner processes are killed: the entry
// node, every VM and every kubeadm cluster member.
func revokeTargets(spec *labsv1.LabTemplateSpec) []string {
	var out []string
	if spec.Topology.Entry != "" {
		out = append(out, spec.Topology.Entry)
	}
	for _, n := range spec.Topology.Nodes {
		switch {
		case n.Name == spec.Topology.Entry:
		case n.Driver == labsv1.DriverVM:
			out = append(out, n.Name)
		case n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil && n.Cluster.Mode == labsv1.ClusterModeKubeadm:
			for _, m := range n.Cluster.Nodes {
				out = append(out, n.Name+"/"+m.Name)
			}
		}
	}
	return out
}

// revokeOnVM reports whether a revoke target is a VM (a vm node or a kubeadm
// member "<node>/<member>"), where loginuids must be immutable.
func revokeOnVM(spec *labsv1.LabTemplateSpec, on string) bool {
	if strings.Contains(on, "/") {
		return true
	}
	for _, n := range spec.Topology.Nodes {
		if n.Name == on {
			return n.Driver == labsv1.DriverVM
		}
	}
	return false
}

// revokeAccess withdraws endpoints and, once, kills the learner's processes
// on every target node. A node that cannot be reached (e.g. a VM that is
// still booting) is retried on the next reconcile; nodes that are gone
// (Failed/Destroyed sessions) count as revoked.
func (r *LabSessionReconciler) revokeAccess(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) error {
	s.Status.Endpoints = nil
	if meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionAccessRevoked) {
		return nil
	}
	ex := &NodeExecutor{Drivers: r.Drivers, Session: s, Template: tpl.spec}
	var errs error
	var running []string
	run := revokeScript(s, r.now())
	for _, on := range revokeTargets(tpl.spec) {
		a := labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &run, TimeoutSec: revokeActionTimeoutS}
		res, err := ex.RunAction(ctx, a)
		if err != nil && !drivers.IsPermanent(err) {
			errs = errors.Join(errs, err)
		}
		running = append(running, stillRunning(on, res.Stdout)...)
		if err == nil && revokeOnVM(tpl.spec, on) {
			check := revokeLoginuidCheck
			cres, cerr := ex.RunAction(ctx, labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &check, TimeoutSec: revokeActionTimeoutS})
			if cerr != nil {
				running = append(running, on+": loginuid lock not checked: "+firstLine(cerr.Error()))
			}
			running = append(running, stillRunning(on, cres.Stdout)...)
		}
	}
	s.Status.StillRunningAfterRevoke = running
	if len(running) > 0 {
		r.event(s, "Warning", "StillRunningAfterRevoke", "units or processes started after Ready still run: "+strings.Join(running, ", "))
	}
	if errs != nil {
		r.setCondition(s, labsv1.ConditionAccessRevoked, metav1.ConditionFalse, ReasonRevokePending, "revoking learner access: "+firstLine(errs.Error()))
		return fmt.Errorf("revoke access: %w", errs)
	}
	r.setCondition(s, labsv1.ConditionAccessRevoked, metav1.ConditionTrue, ReasonAccessRevoked, "learner access revoked; endpoints withdrawn and learner processes ended")
	r.event(s, "Normal", ReasonAccessRevoked, "learner access revoked")
	return nil
}

func firstLine(s string) string {
	for i, c := range s {
		if c == '\n' {
			return s[:i]
		}
	}
	return s
}
