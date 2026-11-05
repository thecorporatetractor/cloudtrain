package controller

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strconv"
	"strings"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// The exam freeze compares what can still change state during grading with
// a snapshot taken when the environment became Ready (before the candidate
// had access): status.readySnapshot. Guest scripts print measurements as
// "cloudtrain-revoke: m: <kind> ..." lines, the same at Ready and at the
// freeze; the controller parses and compares them, so the comparison is
// unit-testable and the reference never lives on a node the candidate (who
// may be root) can write to.
//
//	F <class> <inode> <ctime> <hash16> <path>  a file (class unit, cron, tool)
//	W <class>                    a file with a newline in its path (not measured)
//	S systemd                    the node runs systemd
//	A <unit>                     an active timer/path/socket
//	E <unit>                     an enabled unit file (Ready)
//	B <bootid> <uptime>          boot id and uptime (s) at Ready
//	I <instance>                 the node's instance id at Ready (added by the controller)
//	N <unit>                     a unit that became active after Ready (freeze)
//	T <trigger> <unit>           an active timer/path/socket and a unit it triggers (freeze)
//	P <unit> <path>              the unit's fragment path (freeze)
//	B rebooted                   the node rebooted after Ready (freeze)
//	R <pid> <after> <ns> <id>    a verified container runtime PID (freeze)
//	X <pid> <after> <pidfile>    a pid file naming something else (freeze)
//	K ok                         the cluster API answered both queries
//	K cronjob <uid> g=<generation> s=<suspend> <ns>/<name>
//	K job <uid> a=<active> <ns>/<name> c=<controller uid> m=<managers...>
//	Z done                       the script got to its end
const measurePrefix = "cloudtrain-revoke: m: "

// readySnapshot values that are not a measurement.
const (
	snapshotUnavailable = "-"         // the node could not be measured at Ready
	snapshotTooLarge    = "too-large" // over the size budget below
)

// Size budget of status.readySnapshot (gzip+base64). A VM measures to about
// 10-15 KiB; the budget keeps the LabSession far below the API server's
// object size limit (1.5 MiB) even for large topologies. A node over its
// share is recorded as too large and reported at the freeze.
const (
	maxSnapshotNode  = 128 << 10
	maxSnapshotTotal = 640 << 10
)

// freezeMeasureSh defines the measuring helpers shared by RevokeScript,
// ReadySnapshotScript and ClusterSnapshotScript. mjoin pairs
// "inode ctime path" (stat) with "hash  path" (sha256sum) lines and prints F
// lines; paths are sanitised the same way at Ready and at the freeze, so
// they compare equal. A path with a newline cannot be paired: it is never
// measured and "W <class>" says it exists.
const freezeMeasureSh = `NL='
'
M="cloudtrain-revoke: m:"
mjoin() {
  awk -v c="$1" -v m="$M" '$0 == "@@" {sh = 1; next} !sh {p = $0; sub(/^[^ ]+ [^ ]+ /, "", p); id[p] = $1 " " $2; next} {p = substr($0, 67); s[p] = substr($0, 1, 16)} END {for (p in id) {q = p; gsub(/[^A-Za-z0-9._\/@:+-]/, "_", q); h = "?"; if (p in s) h = s[p]; print m " F " c " " id[p] " " h " " substr(q, 1, 240)}}'
}
measure() {
  c=$1; shift
  [ $# -gt 0 ] || return 0
  { stat -L -c '%i %Z %n' -- "$@" 2>/dev/null; echo @@; sha256sum -- "$@" 2>/dev/null; } | mjoin "$c"
}
measure_find() {
  c=$1; shift
  if [ -n "$(find -L "$@" -path "*$NL*" -print 2>/dev/null | head -c 1)" ]; then echo "$M W $c"; fi
  { find -L "$@" ! -path "*$NL*" -exec stat -L -c '%i %Z %n' {} + 2>/dev/null; echo @@; find -L "$@" ! -path "*$NL*" -exec sha256sum {} + 2>/dev/null; } | mjoin "$c"
}
measure_units() {
  set --
  for d in /etc/systemd/system /etc/systemd/system.control /run/systemd/system /run/systemd/system.control /run/systemd/generator /run/systemd/generator.early /run/systemd/generator.late /usr/local/lib/systemd/system /usr/lib/systemd/system; do set -- "$@" "$ROOT$d"; done
  [ -L "$ROOT/lib" ] || set -- "$@" "$ROOT/lib/systemd/system"
  measure_find unit "$@" -type f ! -path '*.wants/*' ! -path '*.requires/*' ! -path '*.upholds/*'
}
measure_cron() {
  set --
  for d in /etc/crontab /etc/anacrontab /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /etc/crontabs /var/spool/cron /var/spool/at /var/spool/atjobs; do set -- "$@" "$ROOT$d"; done
  measure_find cron "$@" -type f ! -name .SEQ ! -path '*/atspool/*' ! -path "$ROOT/var/spool/at/spool/*"
}
measure_tools() {
  set --
  for t in sh awk stat sha256sum find readlink tr head cut kill pkill xargs systemctl loginctl getconf; do
    p=$(command -v "$t" 2>/dev/null) || continue
    case $p in /*) set -- "$@" "$p" ;; esac
  done
  for p in "$ROOT"/usr/bin/conmon "$ROOT"/usr/libexec/podman/conmon "$ROOT"/usr/local/bin/conmon "$ROOT"/usr/local/libexec/podman/conmon \
    "$ROOT"/usr/bin/containerd-shim* "$ROOT"/usr/local/bin/containerd-shim* "$ROOT"/var/lib/rancher/k3s/data/*/bin/containerd-shim*; do
    [ -f "$p" ] && set -- "$@" "$p"
  done
  measure tool "$@"
}
fragment() {
  fp=$(systemctl show -p FragmentPath --value "$1" 2>/dev/null)
  [ -n "$fp" ] && echo "$M P $1 $(printf '%s' "$fp" | tr -c 'A-Za-z0-9._/@:+-' '_' | head -c 240)"
}
`

// ReadySnapshotScript measures a node at Ready (see measurePrefix): its
// boot id and uptime, unit files (systemd's unit search path, enablement
// links aside), the active timers/paths/sockets, the enabled unit files,
// cron/at files and the tools. It runs as root, always exits 0 and changes
// nothing.
const ReadySnapshotScript = `PATH=/usr/sbin:/usr/bin:/sbin:/bin
PROC=/proc
ROOT=''
` + freezeMeasureSh + `echo "$M B $(tr -cd '0-9a-f-' < "$PROC/sys/kernel/random/boot_id" 2>/dev/null) $(cut -d. -f1 "$PROC/uptime")"
if [ -d "$ROOT/run/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  echo "$M S systemd"
  measure_units
  systemctl list-units --plain --no-legend --no-pager --type=timer,path,socket --state=active 2>/dev/null | awk -v m="$M" '{print m " A " $1}'
  systemctl list-unit-files --plain --no-legend --no-pager --state=enabled 2>/dev/null | awk -v m="$M" '{print m " E " $1}'
fi
measure_cron
measure_tools
echo "$M Z done"
exit 0`

// ClusterSnapshotScript lists a cluster's CronJobs and Jobs (run with the
// admin kubeconfig on the entry node, at Ready and at the freeze) and
// measures the kubectl and kubeconfig it used, so a replaced kubectl (one
// that prints nothing) or a kubeconfig pointed elsewhere is reported. The
// uid and the generation of a CronJob are set by the API server (the
// generation changes with the spec only), so a CronJob created or changed
// after Ready cannot pass for one from setup.
const ClusterSnapshotScript = `PATH=/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/bin
ROOT=''
` + freezeMeasureSh + `k() { kubectl --request-timeout=15s get "$@" 2>/dev/null; }
set --
kc=$(command -v kubectl 2>/dev/null) && set -- "$kc"
[ -n "$KUBECONFIG" ] && set -- "$@" "$KUBECONFIG"
measure tool "$@"
if cj=$(k cronjobs -A -o jsonpath='{range .items[*]}{"K cronjob "}{.metadata.uid}{" g="}{.metadata.generation}{" s="}{.spec.suspend}{" "}{.metadata.namespace}/{.metadata.name}{"\n"}{end}') &&
  jobs=$(k jobs -A -o jsonpath='{range .items[*]}{"K job "}{.metadata.uid}{" a="}{.status.active}{" "}{.metadata.namespace}/{.metadata.name}{" c="}{.metadata.ownerReferences[?(@.controller==true)].uid}{" m="}{.metadata.managedFields[*].manager}{"\n"}{end}'); then
  printf '%s\n%s\n' "$cj" "$jobs" | awk -v m="$M" 'NF {print m " " $0}'
  echo "$M K ok"
fi
echo "$M Z done"
exit 0`

type fileID struct{ inode, ctime, hash string }

type measuredFile struct {
	class, path string
	id          fileID
}

type runtimePID struct {
	pid, ns, id string
	after       bool
}

type strayPidFile struct {
	pid, file string
	after     bool
}

type cronJob struct {
	uid, gen, name string
	suspended      bool
}

type job struct {
	uid, name, controller string
	managers              []string
	active                int
}

type trigger struct{ by, unit string }

// measurement is one parsed run of ReadySnapshotScript, RevokeScript or
// ClusterSnapshotScript.
type measurement struct {
	files      []measuredFile
	unmeasured []string // classes with a file that has a newline in its path
	systemd    bool
	active     []string
	enabled    []string
	started    []string // N
	triggers   []trigger
	fragments  map[string]string
	bootID     string
	uptime     int
	rebooted   bool
	instance   string
	runtimes   []runtimePID
	strays     []strayPidFile
	cronJobs   []cronJob
	jobs       []job
	clusterOK  bool
	done       bool
}

// parseMeasurement reads the measurement lines of a script's stdout and
// ignores everything else (malformed lines included).
func parseMeasurement(stdout string) *measurement {
	m := &measurement{fragments: map[string]string{}, uptime: -1}
	for _, l := range strings.Split(stdout, "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(l), measurePrefix)
		if !ok {
			continue
		}
		f := strings.Fields(rest)
		if len(f) == 0 {
			continue
		}
		switch n := len(f); f[0] {
		case "F":
			if n == 6 {
				m.files = append(m.files, measuredFile{class: f[1], path: f[5], id: fileID{f[2], f[3], f[4]}})
			}
		case "W":
			if n == 2 {
				m.unmeasured = append(m.unmeasured, f[1])
			}
		case "S":
			m.systemd = true
		case "A":
			if n == 2 {
				m.active = append(m.active, f[1])
			}
		case "E":
			if n == 2 {
				m.enabled = append(m.enabled, f[1])
			}
		case "N":
			if n == 2 {
				m.started = append(m.started, f[1])
			}
		case "T":
			if n == 3 {
				m.triggers = append(m.triggers, trigger{f[1], f[2]})
			}
		case "P":
			if n == 3 {
				m.fragments[f[1]] = f[2]
			}
		case "B":
			if n == 2 && f[1] == "rebooted" {
				m.rebooted = true
			} else if n == 3 {
				m.bootID = f[1]
				if u, err := strconv.Atoi(f[2]); err == nil {
					m.uptime = u
				}
			}
		case "I":
			if n == 2 {
				m.instance = f[1]
			}
		case "R":
			if n == 5 {
				m.runtimes = append(m.runtimes, runtimePID{pid: f[1], after: f[2] == "1", ns: f[3], id: f[4]})
			}
		case "X":
			if n == 4 {
				m.strays = append(m.strays, strayPidFile{pid: f[1], after: f[2] == "1", file: f[3]})
			}
		case "K":
			parseClusterLine(m, f[1:])
		case "Z":
			m.done = n == 2 && f[1] == "done"
		}
	}
	return m
}

func parseClusterLine(m *measurement, f []string) {
	if len(f) == 0 {
		return
	}
	switch {
	case f[0] == "ok" && len(f) == 1:
		m.clusterOK = true
	case f[0] == "cronjob" && len(f) == 5:
		g, _ := strings.CutPrefix(f[2], "g=")
		s, _ := strings.CutPrefix(f[3], "s=")
		m.cronJobs = append(m.cronJobs, cronJob{uid: f[1], gen: g, suspended: s == "true", name: f[4]})
	case f[0] == "job" && len(f) >= 6:
		a, _ := strings.CutPrefix(f[2], "a=")
		n, _ := strconv.Atoi(a)
		c, _ := strings.CutPrefix(f[4], "c=")
		j := job{uid: f[1], active: n, name: f[3], controller: c}
		if mg, ok := strings.CutPrefix(f[5], "m="); ok {
			if mg != "" {
				j.managers = append(j.managers, mg)
			}
			j.managers = append(j.managers, f[6:]...)
		}
		m.jobs = append(m.jobs, j)
	}
}

type readyFile struct {
	class string
	id    fileID
}

// readyRef is a Ready-time measurement indexed for comparison.
type readyRef struct {
	files      map[string]readyFile
	classes    map[string]int
	systemd    bool
	triggers   map[string]bool // active or enabled at Ready
	bootID     string
	uptime     int
	instance   string
	cronJobGen map[string]string
	jobs       map[string]bool
	clusterOK  bool
}

func newReadyRef(m *measurement) *readyRef {
	r := &readyRef{files: map[string]readyFile{}, classes: map[string]int{}, systemd: m.systemd, triggers: map[string]bool{},
		bootID: m.bootID, uptime: m.uptime, instance: m.instance, cronJobGen: map[string]string{}, jobs: map[string]bool{}, clusterOK: m.clusterOK}
	for _, f := range m.files {
		if _, ok := r.files[f.path]; !ok {
			r.files[f.path] = readyFile{f.class, f.id}
			r.classes[f.class]++
		}
	}
	for _, u := range append(append([]string{}, m.active...), m.enabled...) {
		r.triggers[u] = true
	}
	for _, c := range m.cronJobs {
		r.cronJobGen[c.uid] = c.gen
	}
	for _, j := range m.jobs {
		r.jobs[j.uid] = true
	}
	return r
}

// freezeParams renders the freeze for a node: with a snapshot of the same
// instance, "after Ready" is the uptime at the snapshot (valid while the
// boot id is the same); a resumed or replaced instance falls back to the
// seconds since Ready. The runtime binaries are recognised by content.
func (r *readyRef) freezeParams(since int, instance string) freezeParams {
	p := freezeParams{since: since, readyUp: -1}
	if r == nil {
		return p
	}
	var bins []string
	for path, f := range r.files {
		b := path[strings.LastIndex(path, "/")+1:]
		if f.class == "tool" && (b == "conmon" || strings.HasPrefix(b, "containerd-shim")) && f.id.hash != "?" {
			bins = append(bins, f.id.hash)
		}
	}
	sort.Strings(bins)
	p.rtbins = strings.Join(bins, " ")
	if !r.instanceChanged(instance) && r.bootID != "" && r.uptime >= 0 {
		p.readyUp, p.bootID = r.uptime, r.bootID
	}
	return p
}

func (r *readyRef) instanceChanged(cur string) bool {
	return r.instance != "" && cur != "" && r.instance != cur
}

// file looks a path up; on a merged-/usr system systemd may name a unit
// file /lib/... while the snapshot walked /usr/lib/... (or the reverse).
func (r *readyRef) file(p string) (readyFile, bool) {
	if f, ok := r.files[p]; ok {
		return f, true
	}
	if q, ok := strings.CutPrefix(p, "/usr/lib/"); ok {
		f, ok := r.files["/lib/"+q]
		return f, ok
	}
	if q, ok := strings.CutPrefix(p, "/lib/"); ok {
		f, ok := r.files["/usr/lib/"+q]
		return f, ok
	}
	return readyFile{}, false
}

// changed reports whether a file differs from (or is missing in) the Ready
// snapshot. Files under /run are regenerated at boot (generators), and a
// resumed, replaced or rebooted node has new inodes: only content counts
// there.
func (r *readyRef) changed(f measuredFile, contentOnly bool) bool {
	was, ok := r.file(f.path)
	if !ok {
		return true
	}
	if contentOnly || strings.HasPrefix(f.path, "/run/") {
		return was.id.hash != f.id.hash
	}
	return was.id != f.id
}

// encodeSnapshot keeps the measurement lines of a Ready run (plus the node's
// instance id), compressed.
func encodeSnapshot(stdout, instance string) (string, error) {
	var lines []string
	if instance != "" {
		lines = append(lines, "I "+instance)
	}
	for _, l := range strings.Split(stdout, "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(l), measurePrefix); ok {
			lines = append(lines, rest)
		}
	}
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := io.WriteString(w, strings.Join(lines, "\n")); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b.Bytes()), nil
}

// decodeSnapshot returns the Ready reference of one node, or nil and why
// there is none.
func decodeSnapshot(v string) (*readyRef, string, error) {
	switch v {
	case "":
		return nil, "no Ready-time snapshot", nil
	case snapshotUnavailable:
		return nil, "the node could not be measured at Ready", nil
	case snapshotTooLarge:
		return nil, "the Ready-time snapshot was over its size budget", nil
	}
	raw, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		return nil, "", err
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, "", err
	}
	data, err := io.ReadAll(io.LimitReader(zr, 16<<20))
	if err != nil {
		return nil, "", err
	}
	var b strings.Builder
	for _, l := range strings.Split(string(data), "\n") {
		b.WriteString(measurePrefix + l + "\n")
	}
	return newReadyRef(parseMeasurement(b.String())), "", nil
}

// reporter collects "node: ..." entries once each.
type reporter struct {
	node string
	out  []string
	seen map[string]bool
}

func (r *reporter) add(key, msg string) {
	if r.seen == nil {
		r.seen = map[string]bool{}
	}
	if !r.seen[key] {
		r.seen[key] = true
		r.out = append(r.out, r.node+": "+msg)
	}
}

// compareWithReady turns a node's freeze run into report entries ("node:
// ..."), in the format of stillRunning. ready is nil without a usable Ready
// snapshot (why says why); instance is the node's current instance id;
// reported are the units the script already reported.
func compareWithReady(node string, ready *readyRef, why, instance string, cur *measurement, reported map[string]bool) []string {
	rp := &reporter{node: node}
	if !cur.done {
		rp.add("incomplete", "freeze measurements missing or incomplete (not checked)")
	}
	for _, c := range cur.unmeasured {
		rp.add("w:"+c, c+" files with a newline in their path (not measured)")
	}
	if ready == nil {
		rp.add("nosnap", "unit files, cron/at jobs and tools not compared ("+why+")")
	} else {
		compareFiles(rp, ready, instance, cur, reported)
	}
	for _, r := range cur.runtimes {
		// Kubernetes pods (CRI) are the cluster's workloads, not a
		// container the candidate ran with podman or docker.
		if !r.after || r.ns == "k8s.io" || r.ns == "crio" {
			continue
		}
		rp.add("c:"+r.id, fmt.Sprintf("container %s %s (started after Ready, runtime pid %s)", r.ns, short(r.id), r.pid))
	}
	for _, x := range cur.strays {
		if x.after {
			rp.add("x:"+x.file, fmt.Sprintf("pid file %s names process %s, which is not its container runtime", x.file, x.pid))
		}
	}
	return rp.out
}

func short(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func compareFiles(rp *reporter, ready *readyRef, instance string, cur *measurement, reported map[string]bool) {
	contentOnly := false
	if ready.instanceChanged(instance) {
		rp.add("instance", "node instance changed since the Ready snapshot (resumed or replaced): files compared by content only")
		contentOnly = true
	}
	if cur.rebooted {
		rp.add("rebooted", "rebooted after Ready: files compared by content only; processes and containers not checked")
		contentOnly = true
	}
	measured := map[string]map[string]bool{}
	for _, f := range cur.files {
		if measured[f.class] == nil {
			measured[f.class] = map[string]bool{}
		}
		measured[f.class][f.path] = true
	}
	for _, class := range []string{"unit", "cron", "tool"} {
		if ready.classes[class] > 0 && len(measured[class]) == 0 {
			rp.add("m:"+class, class+" files not measured at the freeze (not checked)")
		}
	}
	// Unit files: what changed, appeared or disappeared since Ready.
	var unitChanges []string
	if len(measured["unit"]) > 0 {
		for _, f := range cur.files {
			if f.class == "unit" && ready.changed(f, contentOnly) {
				unitChanges = append(unitChanges, f.path)
			}
		}
		for p, f := range ready.files {
			if f.class == "unit" && !measured["unit"][p] && !measured["unit"][altLib(p)] {
				unitChanges = append(unitChanges, p)
			}
		}
		sort.Strings(unitChanges)
	}
	for _, u := range cur.started {
		if reported[u] {
			continue
		}
		if p := unitChange(u, cur.fragments[u], unitChanges); p != "" {
			rp.add("u:"+u, u+" (unit file differs from the Ready snapshot: "+p+")")
		}
	}
	for _, t := range cur.triggers {
		if reported[t.by] {
			continue
		}
		if p := unitChange(t.unit, cur.fragments[t.unit], unitChanges); p != "" {
			rp.add("u:"+t.by, t.by+" (triggers "+t.unit+": "+p+" differs from the Ready snapshot)")
		}
	}
	if ready.systemd {
		for _, t := range cur.active {
			if !ready.triggers[t] && !reported[t] {
				rp.add("u:"+t, t+" (started after Ready)")
			}
		}
	}
	files := append([]measuredFile(nil), cur.files...)
	sort.SliceStable(files, func(i, j int) bool { return files[i].path < files[j].path })
	for _, f := range files {
		if !ready.changed(f, contentOnly) {
			continue
		}
		switch f.class {
		case "cron":
			// A removed cron/at file stops a job: not reported.
			if isAtSpool(f.path) {
				rp.add("f:"+f.path, "at job "+f.path+" (queued after Ready)")
			} else {
				rp.add("f:"+f.path, "cron "+f.path+" (new or changed since Ready)")
			}
		case "tool":
			rp.add("f:"+f.path, "tool "+f.path+" (changed since Ready; the freeze results of this node are not reliable)")
		}
	}
	if len(measured["tool"]) > 0 {
		var gone []string
		for p, f := range ready.files {
			if f.class == "tool" && !measured["tool"][p] {
				gone = append(gone, p)
			}
		}
		sort.Strings(gone)
		for _, p := range gone {
			rp.add("f:"+p, "tool "+p+" (missing at the freeze; the freeze results of this node are not reliable)")
		}
	}
}

func altLib(p string) string {
	if q, ok := strings.CutPrefix(p, "/usr/lib/"); ok {
		return "/lib/" + q
	}
	if q, ok := strings.CutPrefix(p, "/lib/"); ok {
		return "/usr/lib/" + q
	}
	return p
}

// unitChange returns the first changed path that defines unit u: its
// fragment (fragment path, its name, or the template it instantiates) or a
// drop-in (u.d, the template's, a prefix drop-in such as a-.service.d, or
// the type-wide service.d).
func unitChange(u, fragment string, changed []string) string {
	for _, p := range changed {
		if p == fragment || altLib(p) == fragment || affects(u, p) {
			return p
		}
	}
	return ""
}

func affects(u, p string) bool {
	dir := path.Base(path.Dir(p))
	typ := u[strings.LastIndex(u, ".")+1:]
	if d, ok := strings.CutSuffix(dir, ".d"); ok {
		if d == typ || unitNamed(u, d) {
			return true
		}
		// Prefix drop-ins: a-.service.d applies to a-b.service, a-b-c.service.
		if pre, ok := strings.CutSuffix(d, "-."+typ); ok && strings.HasPrefix(u, pre+"-") {
			return true
		}
		return false
	}
	return unitNamed(u, path.Base(p))
}

// unitNamed: u is name, or an instance of the template name (a@.service).
func unitNamed(u, name string) bool {
	if u == name {
		return true
	}
	if pre, ok := strings.CutSuffix(name, "@"+u[strings.LastIndex(u, "."):]); ok && strings.Contains(name, "@.") {
		return strings.HasPrefix(u, pre+"@")
	}
	return false
}

// compareCluster reports, for a cluster target: CronJobs created or changed
// after Ready that are not suspended (they can run during grading) and Jobs
// created after Ready that still run. A Job is exempt only when its
// controller is a CronJob unchanged since Ready and kube-controller-manager
// is its only field manager. ownerReferences and managedFields are written
// by clients, so a cluster-admin candidate can forge both: the exemption
// keeps setup CronJobs from flagging every attempt and is not proof.
func compareCluster(node string, ready *readyRef, why, instance string, cur *measurement) []string {
	rp := &reporter{node: node}
	if !cur.clusterOK || !cur.done {
		rp.add("k", "cluster CronJobs and Jobs not checked (the API did not answer at the freeze)")
	}
	if ready == nil {
		rp.add("nosnap", "cluster CronJobs and Jobs not compared ("+why+")")
		return rp.out
	}
	if !ready.clusterOK {
		rp.add("nosnap", "cluster CronJobs and Jobs not compared (the API did not answer at Ready)")
	}
	if ready.instanceChanged(instance) {
		rp.add("instance", "cluster replaced since the Ready snapshot: CronJobs and Jobs not compared")
		return rp.out
	}
	compareFiles(rp, ready, instance, cur, nil) // kubectl and the kubeconfig
	if !cur.clusterOK || !ready.clusterOK {
		return rp.out
	}
	for _, c := range cur.cronJobs {
		if g, ok := ready.cronJobGen[c.uid]; !c.suspended && (!ok || g != c.gen) {
			rp.add("cj:"+c.uid, "cronjob "+c.name+" (created or changed after Ready)")
		}
	}
	for _, j := range cur.jobs {
		if j.active <= 0 || ready.jobs[j.uid] {
			continue
		}
		if g, ok := ready.cronJobGen[j.controller]; ok && j.controller != "" && !cronJobChanged(cur, j.controller, g) && onlyManager(j.managers, "kube-controller-manager") {
			continue
		}
		rp.add("j:"+j.uid, "job "+j.name+" (started after Ready, still running)")
	}
	return rp.out
}

func onlyManager(ms []string, want string) bool {
	if len(ms) == 0 {
		return false
	}
	for _, m := range ms {
		if m != want {
			return false
		}
	}
	return true
}

func cronJobChanged(cur *measurement, uid, gen string) bool {
	for _, c := range cur.cronJobs {
		if c.uid == uid {
			return c.gen != gen
		}
	}
	return false // deleted since: it no longer schedules anything
}

func isAtSpool(p string) bool {
	return strings.Contains(p, "/var/spool/at/") || strings.Contains(p, "/var/spool/atjobs/") ||
		strings.Contains(p, "/var/spool/cron/atjobs/")
}

// reportedUnits are the units a RevokeScript run already reported.
func reportedUnits(stdout string) map[string]bool {
	out := map[string]bool{}
	for _, l := range strings.Split(stdout, "\n") {
		if u, ok := strings.CutPrefix(strings.TrimSpace(l), revokeStillRunning); ok {
			if f := strings.Fields(u); len(f) > 0 {
				out[f[0]] = true
			}
		}
	}
	return out
}

// clusterTargets are the cluster nodes (vcluster, kubeadm) whose CronJobs
// and Jobs the freeze compares; they run ClusterSnapshotScript on the entry
// node with the cluster's admin kubeconfig.
func clusterTargets(spec *labsv1.LabTemplateSpec) []string {
	var out []string
	for _, n := range spec.Topology.Nodes {
		if n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil {
			out = append(out, n.Name)
		}
	}
	return out
}

func clusterScript() string { return ClusterSnapshotScript }

// nodeInstance is the current instance id of a target ("node" or
// "node/member": the node's).
func nodeInstance(s *labsv1.LabSession, on string) string {
	name, _, _ := strings.Cut(on, "/")
	for _, n := range s.Status.Nodes {
		if n.Name == name {
			return n.InstanceID
		}
	}
	return ""
}

// needsReadySnapshot: exam environments take the snapshot once setup is
// done and before endpoints are (re)published. A session that already had
// endpoints (Ready before this snapshot existed) is not measured late: that
// would record the candidate's changes as the reference.
func needsReadySnapshot(s *labsv1.LabSession) bool {
	if s.Labels[labsv1.LabelExamSession] == "" || s.Status.ReadySnapshot != nil || accessRevoked(s) {
		return false
	}
	return s.Status.ReadyAt == nil || len(s.Status.Endpoints) == 0
}

// takeReadySnapshot measures every revoke target and cluster. A node that
// cannot be measured for good (no exec) is recorded as unavailable;
// transient errors are returned so the reconcile retries before Ready.
func takeReadySnapshot(ctx context.Context, ex *NodeExecutor, spec *labsv1.LabTemplateSpec) (map[string]string, error) {
	out := map[string]string{}
	run := func(on, script string) error {
		res, err := ex.RunAction(ctx, labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &script, TimeoutSec: readySnapshotTimeoutS})
		if err != nil {
			if drivers.IsPermanent(err) || errors.Is(err, errActionFailed) {
				out[on] = snapshotUnavailable
				return nil
			}
			return err
		}
		v, err := encodeSnapshot(res.Stdout, nodeInstance(ex.Session, on))
		if err != nil {
			return err
		}
		out[on] = v
		return nil
	}
	for _, on := range revokeTargets(spec) {
		if err := run(on, ReadySnapshotScript); err != nil {
			return nil, fmt.Errorf("ready snapshot: %w", err)
		}
	}
	for _, on := range clusterTargets(spec) {
		if err := run(on, ClusterSnapshotScript); err != nil {
			return nil, fmt.Errorf("ready snapshot: %w", err)
		}
	}
	capSnapshot(out)
	return out, nil
}

// capSnapshot enforces the size budget: a node over maxSnapshotNode, then
// the largest nodes until the total fits, are recorded as too large.
func capSnapshot(m map[string]string) {
	total := 0
	for k, v := range m {
		if len(v) > maxSnapshotNode {
			m[k] = snapshotTooLarge
		}
		total += len(m[k])
	}
	for total > maxSnapshotTotal {
		big := ""
		for k, v := range m {
			if big == "" || len(v) > len(m[big]) || (len(v) == len(m[big]) && k < big) {
				big = k
			}
		}
		total -= len(m[big]) - len(snapshotTooLarge)
		m[big] = snapshotTooLarge
	}
}

const readySnapshotTimeoutS = 60
