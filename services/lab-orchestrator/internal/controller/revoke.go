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
	revokeActionTimeoutS = 90 // the freeze also measures the node (and, after a reboot, every active unit)
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
//     PID 1 inside a *.service (other than an active service's main process
//     or a container runtime, see below), or a process in a container scope
//     that is neither a container runtime nor one of its descendants, which
//     is where `echo $pid > .../cron.service/cgroup.procs` leaves a
//     daemonised loop. Without systemd, as in a kubectl-exec entry
//     container: anything whose ancestry ends at PID 1, i.e. was daemonised,
//     rather than at an exec from outside the container. Reported as
//     "cloudtrain-revoke: new process: <comm>[<pid>] <cgroup>". This catches
//     what the tree walk cannot see, e.g. `sudo setsid -f sh -c 'while :; do
//     ...; done'` from a shell without a loginuid, or after the learner
//     rewrote /proc/self/loginuid as root (VMs also make loginuid immutable
//     at boot where auditctl exists, see kubevirt.go).
//
// Container runtimes are recognised by identity, not by name (see
// revokeRuntimeSh): a PID named in a conmon.pid or containerd shim.pid whose
// cgroup is that runtime's (libpod-conmon-<id>.scope / crio-conmon-<id>.scope
// for conmon, the containerd, docker or k3s service for a shim) and whose
// running executable has the content of a conmon/shim binary measured at
// Ready (rtbins). The pid files alone are never trusted: a root learner can
// write them.
//
// The script also prints measurements ("cloudtrain-revoke: m: ...", see
// readysnap.go) that the controller compares with the session's Ready-time
// snapshot (status.readySnapshot): every unit file, the units that became
// active after Ready with their fragment paths, the active
// timers/paths/sockets with the units they trigger, the cron and at files
// and the tools this script runs, ending with "m: Z done". That finds a unit
// file or drop-in edited with the clock set back, a timer that fires an
// edited service during grading, new cron/at jobs and replaced tools.
//
// Timing: with a snapshot, "after Ready" is measured against the node's
// uptime when the snapshot was taken and only if the node has not rebooted
// since (same boot id); after a reboot (or hibernation) the script prints
// "m: B rebooted" and checks no process or start time, every active unit
// counts as started after Ready, and files are compared by content. Without
// a snapshot it falls back to the seconds since Ready (@SINCE@).
//
// Not detected here: a changed program or script a unit or cron job runs
// (only the unit/cron files are compared), and Kubernetes workloads (see
// ClusterSnapshotScript for cluster CronJobs and Jobs).
//
// PATH is fixed so a root learner's /usr/local/sbin/awk is not run. The
// script is rendered with revokeScript (placeholders, no fmt verbs).
const RevokeScript = `u=learner
since=@SINCE@
readyup=@READYUP@
readyboot='@BOOTID@'
rtbins=' @RTBINS@ '
PROC=/proc
RUN=/run
ROOT=''
PATH=/usr/sbin:/usr/bin:/sbin:/bin
if id "$u" >/dev/null 2>&1; then
uid=$(id -u "$u")
tree() {
  for d in "$PROC"/[0-9]*; do
    cg=$(awk -F: '$1 == "0" || $2 ~ /name=systemd/ {print $3; exit}' "$d/cgroup" 2>/dev/null)
    awk -v p="${d##*/}" -v lu="$(cat "$d/loginuid" 2>/dev/null)" -v cg="${cg:-?}" \
      '/^PPid:/{pp=$2} /^Uid:/{own=$2} END{gsub(/[[:space:]]/, "_", cg); if (pp != "") print p, pp, own, lu, cg}' "$d/status" 2>/dev/null
  done | awk -v uid="$uid" -v self="$$" -v mode="$1" '` + revokeTreeAwk + `'
}
# shellcheck disable=SC2034
for round in 1 2 3; do tree kill | xargs -r kill -STOP 2>/dev/null; done
kept=$(tree keep)
tree kill | xargs -r kill -KILL 2>/dev/null
pkill -KILL -u "$u" 2>/dev/null
if command -v loginctl >/dev/null 2>&1; then loginctl terminate-user "$u" >/dev/null 2>&1; fi
for p in $kept; do
  [ -r "$PROC/$p/status" ] || continue
  c=$(head -c 32 "$PROC/$p/comm" 2>/dev/null | tr -d '\n' | tr -c 'A-Za-z0-9._/@:-' '_')
  o=$(awk '/^Uid:/{print $2}' "$PROC/$p/status" 2>/dev/null)
  echo "` + revokeKept + `${c:-?}[$p] uid=${o:-?}"
done
fi
` + freezeMeasureSh + revokeRuntimeSh + `hz=$(getconf CLK_TCK 2>/dev/null || echo 100)
up=$(cut -d. -f1 "$PROC/uptime")
boot=$(cat "$PROC/sys/kernel/random/boot_id" 2>/dev/null)
rtsec=-1
if [ -n "$readyboot" ]; then
  if [ "$boot" = "$readyboot" ] && [ "$readyup" -ge 0 ] && [ "$readyup" -le "$up" ]; then rtsec=$readyup; else echo "$M B rebooted"; fi
elif [ "$since" -ge 0 ]; then
  rtsec=$((up - since))
  if [ "$rtsec" -lt 0 ]; then rtsec=-1; echo "$M B rebooted"; fi
fi
mains=" "
sd=0
if [ -d "$ROOT/run/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  sd=1
  echo "$M S systemd"
  measure_units
  ref=$((rtsec * 1000000))
  systemctl list-units --plain --no-legend --no-pager --type=service,scope,timer,path,socket --state=active 2>/dev/null | awk '{print $1}' | while IFS= read -r unit; do
    case $unit in session-*.scope|user@*.service|init.scope|docker-*.scope|cri-containerd-*.scope|crio-*.scope|libpod-*.scope) continue ;; esac
    if [ "$rtsec" -ge 0 ]; then
      t=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$unit" 2>/dev/null)
      [ "${t:-0}" -gt "$ref" ] 2>/dev/null || continue
    fi
    if [ "$(systemctl show -p Transient --value "$unit" 2>/dev/null)" = yes ]; then
      [ "$rtsec" -ge 0 ] && echo "` + revokeStillRunning + `$unit"
      continue
    fi
    echo "$M N $unit"
    fragment "$unit"
  done
  systemctl list-units --plain --no-legend --no-pager --type=timer,path,socket --state=active 2>/dev/null | awk '{print $1}' | while IFS= read -r t; do
    echo "$M A $t"
    for tu in $(systemctl show -p Triggers --value "$t" 2>/dev/null); do
      echo "$M T $t $tu"
      fragment "$tu"
    done
  done
  if [ "$rtsec" -ge 0 ]; then
    # shellcheck disable=SC2046
    mains=" $(systemctl show -p MainPID --value $(systemctl list-units --plain --no-legend --no-pager --type=service --state=active 2>/dev/null | awk '{print $1}') 2>/dev/null | tr '\n' ' ') "
  fi
fi
measure_cron
measure_tools
runtimes
if [ "$rtsec" -ge 0 ]; then
  rt=$((rtsec * hz))
  procs() {
    for d in "$PROC"/[0-9]*; do
      cg=$(awk -F: '$1 == "0" || $2 ~ /name=systemd/ {print $3; exit}' "$d/cgroup" 2>/dev/null)
      awk -v p="${d##*/}" -v cg="${cg:-?}" '{gsub(/[[:space:]]/, "_", cg); c = $0; sub(/^[^(]*\(/, "", c); sub(/\)[^)]*$/, "", c); s = $0; sub(/^.*\) /, "", s); split(s, f, " "); print p, f[2], f[20], cg, c}' "$d/stat" 2>/dev/null
    done | awk -v self="$$" -v rt="$rt" -v sd="$sd" -v mains="$mains" -v rpids="$rpids" '` + revokeNewAwk + `'
  }
  first=$(procs); sleep 1
  procs | while IFS= read -r line; do
    case "
$first
" in *"
$line
"*) echo "` + revokeNewProcess + `$line" ;; esac
  done
fi
echo "$M Z done"
exit 0`

// revokeStillRunning prefixes each transient unit the revoke script reports.
const revokeStillRunning = "cloudtrain-revoke: still running: "

// revokeNewProcess prefixes each process started after Ready, outside any
// systemd unit, that survived the kill pass.
const revokeNewProcess = "cloudtrain-revoke: new process: "

// revokeKept prefixes each learner process the freeze kept because it runs
// as another account (see RevokeScript).
const revokeKept = "cloudtrain-revoke: kept: "

// revokeContainerScope matches a cgroup path inside a container's systemd
// scope (podman, conmon, docker, containerd, CRI-O) below a slice.
const revokeContainerScope = `/[.]slice\/(libpod|libpod-conmon|docker|cri-containerd|crio|crio-conmon)-[0-9a-f]+[.]scope(\/|$)/`

// revokeRuntimeSh defines runtimes(): it reads the pid files of container
// runtimes (conmon for podman/CRI-O, rootful and rootless; containerd shims
// for containerd, docker's own containerd, rootless docker, k3s) under $RUN
// and accepts a PID as a runtime only when
//   - its cgroup ($PROC/<pid>/cgroup) is the runtime's own: conmon in
//     libpod-conmon-<id>.scope or crio-conmon-<id>.scope of the same
//     container id, a shim in the containerd, docker or k3s service, and
//   - its running executable ($PROC/<pid>/exe) has the content (SHA-256) of
//     a conmon/containerd-shim binary measured at Ready (rtbins).
//
// Accepted PIDs go to rpids and are printed "m: R <pid> <after> <ns> <id>";
// a pid file naming anything else "m: X <pid> <after> <pidfile>". after is
// 1 when the process started after Ready (rtsec, in seconds of uptime).
const revokeRuntimeSh = `pst() { awk '{s = $0; sub(/^.*\) /, "", s); split(s, f, " "); print f[20]}' "$PROC/$1/stat" 2>/dev/null; }
exe_ok() {
  h=$(sha256sum < "$PROC/$1/exe" 2>/dev/null | cut -c1-16)
  case $rtbins in *" ${h:-none} "*) return 0 ;; esac
  return 1
}
runtimes() {
  rpids=" "
  for f in "$RUN"/containers/storage/*-containers/*/userdata/conmon.pid "$RUN"/user/*/containers/*-containers/*/userdata/conmon.pid \
    "$RUN"/containerd/io.containerd.runtime.v2.task/*/*/shim.pid "$RUN"/docker/containerd/daemon/io.containerd.runtime.v2.task/*/*/shim.pid \
    "$RUN"/user/*/docker/containerd/daemon/io.containerd.runtime.v2.task/*/*/shim.pid "$RUN"/k3s/containerd/io.containerd.runtime.v2.task/*/*/shim.pid; do
    [ -f "$f" ] || continue
    d=${f%/*}
    case $f in
      */userdata/conmon.pid) id=${d%/userdata}; id=${id##*/}; kind=conmon; ns=conmon ;;
      *) id=${d##*/}; ns=${d%/*}; ns=${ns##*/}; kind=shim ;;
    esac
    case $id in ''|*[!0-9a-f]*) continue ;; esac
    p=$(head -c 16 "$f" 2>/dev/null | tr -cd 0-9)
    [ -n "$p" ] && [ -r "$PROC/$p/stat" ] || continue
    a=0
    if [ "$rtsec" -ge 0 ] && [ "$(pst "$p")" -gt "$((rtsec * hz))" ] 2>/dev/null; then a=1; fi
    cg=$(awk -F: '$1 == "0" || $2 ~ /name=systemd/ {print $3; exit}' "$PROC/$p/cgroup" 2>/dev/null)
    ok=0
    case $kind in
      conmon) case $cg in */libpod-conmon-"$id".scope) ns=podman; ok=1 ;; */crio-conmon-"$id".scope) ns=crio; ok=1 ;; esac ;;
      *) case "$cg/" in */containerd.service/*|*/docker.service/*|*/k3s.service/*|*/k3s-agent.service/*) ok=1 ;; esac ;;
    esac
    case $ns in ''|*[!A-Za-z0-9._-]*) ns=other ;; esac
    if [ "$ok" = 1 ] && exe_ok "$p"; then
      rpids="$rpids$p "
      echo "$M R $p $a $ns $id"
    else
      echo "$M X $p $a $(printf '%s' "$f" | tr -c 'A-Za-z0-9._/@:+-' '_')"
    fi
  done
}
`

// revokeNewAwk reads "pid ppid starttime cgroup comm" lines (starttime in
// clock ticks since boot) and prints "comm[pid] cgroup" for every process
// started after Ready (rt) that is not the revoke script, one of its
// ancestors or a kernel thread, and that no systemd unit owns. With systemd
// (sd=1): no component of its cgroup path is a *.service or a non-session
// *.scope (sub-cgroups of a unit, e.g. systemd-udevd.service/udev, belong to
// it) and it is not in the revoke script's own session; or it was
// re-parented to PID 1 inside a *.service without being the main process of
// an active service (mains: " pid pid ... ") or a container runtime
// (rpids: " pid pid ... ", conmon/shim PIDs verified by the script); or it
// is in a container scope without being a runtime PID or a descendant of
// one (the container's init and everything below it descend from its
// conmon/shim). A process is never accepted for its name. That is where
// moving a daemonised loop into a unit's cgroup.procs leaves it. Without
// systemd: its ancestry ends at PID 1 (daemonised inside the node) rather
// than at an exec from outside (ppid 0). comm and cgroup are
// learner-controlled: anything but [A-Za-z0-9._/@:-] is replaced and both
// are truncated.
const revokeNewAwk = `
    function runtime(p,    q, hops) {
      for (q = p; q != "" && q != 0 && q != 1 && hops++ < 4096; q = pp[q]) if (index(rpids, " " q " ")) return 1
      return 0
    }
    { pp[$1] = $2; st[$1] = $3; cg[$1] = $4; c = $5; for (i = 6; i <= NF; i++) c = c "_" $i; cm[$1] = c }
    END {
      for (q = self; q != "" && q != 0 && !(q in anc); q = pp[q]) anc[q] = 1
      for (p in pp) {
        if (p == 1 || p == 2 || pp[p] == 2 || (p in anc) || st[p] + 0 <= rt + 0) continue
        if (sd == 1) {
          if (cg[p] == cg[self]) continue
          n = split(cg[p], parts, "/"); unit = ""
          for (i = 1; i <= n; i++) if (parts[i] ~ /[.](service|scope)$/ && parts[i] !~ /^session-/) unit = parts[i]
          if (cg[p] ~ ` + revokeContainerScope + `) {
            if (runtime(p)) continue
          } else if (unit != "") {
            if (pp[p] != 1 || index(mains, " " p " ") || index(rpids, " " p " ")) continue
            if (unit ~ /[.]scope$/) continue
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

// freezeParams are what RevokeScript is rendered with for one node.
type freezeParams struct {
	since   int    // seconds since Ready, -1: unknown
	readyUp int    // the node's uptime (s) when the Ready snapshot was taken, -1: none
	bootID  string // its boot id then ("": none)
	rtbins  string // SHA-256 prefixes of the conmon/shim binaries measured at Ready
}

// renderRevoke fills RevokeScript's placeholders. Values are digits, hex
// and dashes only (they go into single quotes).
func renderRevoke(p freezeParams) string {
	clean := func(v, extra string) string {
		return strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || strings.ContainsRune(extra, r) {
				return r
			}
			return -1
		}, v)
	}
	return strings.NewReplacer("@SINCE@", fmt.Sprint(p.since), "@READYUP@", fmt.Sprint(p.readyUp),
		"@BOOTID@", clean(p.bootID, "-"), "@RTBINS@", clean(p.rtbins, " ")).Replace(RevokeScript)
}

// revokeScript renders RevokeScript for a session without a Ready snapshot.
func revokeScript(s *labsv1.LabSession, now time.Time) string {
	return renderRevoke(freezeParams{since: sinceReady(s, now), readyUp: -1})
}

func sinceReady(s *labsv1.LabSession, now time.Time) int {
	if s.Status.ReadyAt != nil && !now.Before(s.Status.ReadyAt.Time) {
		return int(now.Sub(s.Status.ReadyAt.Time) / time.Second)
	}
	return -1
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
	now := r.now()
	compare := s.Status.ReadyAt != nil
	for _, on := range revokeTargets(tpl.spec) {
		ref, why := r.readyRef(s, on)
		run := renderRevoke(ref.freezeParams(sinceReady(s, now), nodeInstance(s, on)))
		a := labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &run, TimeoutSec: revokeActionTimeoutS}
		res, err := ex.RunAction(ctx, a)
		if err != nil && !drivers.IsPermanent(err) {
			errs = errors.Join(errs, err)
		}
		running = append(running, stillRunning(on, res.Stdout)...)
		if compare && err == nil {
			running = append(running, compareWithReady(on, ref, why, nodeInstance(s, on), parseMeasurement(res.Stdout), reportedUnits(res.Stdout))...)
		}
	}
	// Cluster CronJobs and Jobs: reported, never deleted. A cluster that
	// does not answer is reported and does not hold the freeze (nothing is
	// killed there).
	cluster := clusterScript()
	for _, on := range clusterTargets(tpl.spec) {
		if !compare {
			continue
		}
		res, err := ex.RunAction(ctx, labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &cluster, TimeoutSec: revokeActionTimeoutS})
		if err != nil {
			running = append(running, on+": cluster CronJobs and Jobs not checked ("+firstLine(err.Error())+")")
			continue
		}
		ref, why := r.readyRef(s, on)
		running = append(running, compareCluster(on, ref, why, nodeInstance(s, on), parseMeasurement(res.Stdout))...)
	}
	running = capReport(running)
	s.Status.StillRunningAfterRevoke = running
	if len(running) > 0 {
		r.event(s, "Warning", "StillRunningAfterRevoke", truncate("units or processes started after Ready still run: "+strings.Join(running, ", "), 1024))
	}
	if errs != nil {
		r.setCondition(s, labsv1.ConditionAccessRevoked, metav1.ConditionFalse, ReasonRevokePending, "revoking learner access: "+firstLine(errs.Error()))
		return fmt.Errorf("revoke access: %w", errs)
	}
	r.setCondition(s, labsv1.ConditionAccessRevoked, metav1.ConditionTrue, ReasonAccessRevoked, "learner access revoked; endpoints withdrawn and learner processes ended")
	r.event(s, "Normal", ReasonAccessRevoked, "learner access revoked")
	return nil
}

// readyRef decodes one node's Ready snapshot; why says why there is none.
func (r *LabSessionReconciler) readyRef(s *labsv1.LabSession, on string) (*readyRef, string) {
	ref, why, err := decodeSnapshot(s.Status.ReadySnapshot[on])
	if err != nil {
		r.event(s, "Warning", "ReadySnapshotUnreadable", fmt.Sprintf("ready snapshot of %s: %v", on, err))
		return nil, "unreadable"
	}
	return ref, why
}

// Bounds of status.stillRunningAfterRevoke (the status must stay well below
// the API server's object size limit, or the freeze could never be saved).
const (
	maxReportEntries = 50
	maxReportLine    = 300
)

func capReport(in []string) []string {
	out := make([]string, 0, min(len(in), maxReportEntries+1))
	for i, l := range in {
		if i == maxReportEntries {
			out = append(out, fmt.Sprintf("... and %d more", len(in)-maxReportEntries))
			break
		}
		out = append(out, truncate(l, maxReportLine))
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}

func firstLine(s string) string {
	for i, c := range s {
		if c == '\n' {
			return s[:i]
		}
	}
	return s
}
