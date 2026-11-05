package controller

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func mlines(lines ...string) string {
	var b strings.Builder
	for _, l := range lines {
		if strings.HasPrefix(l, "cloudtrain-revoke:") {
			b.WriteString(l + "\n")
		} else {
			b.WriteString(measurePrefix + l + "\n")
		}
	}
	return b.String()
}

func ref(t *testing.T, instance string, lines ...string) *readyRef {
	t.Helper()
	enc, err := encodeSnapshot("noise\n"+mlines(lines...), instance)
	if err != nil {
		t.Fatal(err)
	}
	r, why, err := decodeSnapshot(enc)
	if err != nil || r == nil {
		t.Fatal(why, err)
	}
	return r
}

func eqList(t *testing.T, what string, got, want []string) {
	t.Helper()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("%s:\ngot  %q\nwant %q", what, got, want)
	}
}

func compareNode(ready *readyRef, instance string, out string) []string {
	return compareWithReady("vm1", ready, "no Ready-time snapshot", instance, parseMeasurement(out), reportedUnits(out))
}

var readyUnits = []string{
	"S systemd",
	"F unit 100 1700000000 aaaaaaaaaaaaaaaa /etc/systemd/system/tr-sync.service",
	"F unit 101 1700000000 bbbbbbbbbbbbbbbb /usr/lib/systemd/system/nginx.service",
	"F unit 102 1700000000 cccccccccccccccc /usr/lib/systemd/system/fstrim.service",
	"F unit 103 1700000000 dddddddddddddddd /usr/lib/systemd/system/fstrim.timer",
	"F unit 104 1700000000 eeeeeeeeeeeeeeee /run/systemd/generator/local-fs.service",
	"F unit 105 1700000000 ffffffffffffffff /usr/lib/systemd/system/backup.service",
	"F unit 106 1700000000 1010101010101010 /etc/systemd/system/getty@.service",
	"F unit 107 1700000000 2020202020202020 /etc/systemd/system/web.service.d/limits.conf",
	"F unit 108 1700000000 3030303030303030 /usr/lib/systemd/system/web.service",
	"F tool 12 1700000000 cccccccccccccccc /usr/bin/awk",
	"F cron 10 1700000000 aaaaaaaaaaaaaaaa /etc/cron.d/e2scrub_all",
	"A fstrim.timer",
	"E logrotate.timer",
}

// #394 item 1: a unit file edited in place (its ctime faked before Ready)
// and (re)started after Ready is reported, through its fragment or any
// drop-in (own, template, prefix, type-wide, removed); an unchanged unit the
// learner merely restarted is not.
func TestCompareWithReadyUnits(t *testing.T) {
	ready := ref(t, "i-1", readyUnits...)
	freeze := []string{
		"cloudtrain-revoke: still running: run-u7.service",
		"cloudtrain-revoke: still running: run-u7.timer",
		"F unit 100 1699999000 1111111111111111 /etc/systemd/system/tr-sync.service", // edited, ctime faked into the past
		"F unit 101 1700000000 bbbbbbbbbbbbbbbb /lib/systemd/system/nginx.service",   // unchanged (merged-/usr name)
		"F unit 102 1700000000 cccccccccccccccc /usr/lib/systemd/system/fstrim.service",
		"F unit 103 1700000000 dddddddddddddddd /usr/lib/systemd/system/fstrim.timer",
		"F unit 999 1800000000 eeeeeeeeeeeeeeee /run/systemd/generator/local-fs.service", // regenerated, same content
		"F unit 105 1700000500 9999999999999999 /usr/lib/systemd/system/backup.service",  // the service a timer fires was edited
		"F unit 106 1700000000 1010101010101010 /etc/systemd/system/getty@.service",
		"F unit 300 1700000000 3333333333333333 /etc/systemd/system/getty@.service.d/x.conf", // template drop-in
		"F unit 301 1700000000 4444444444444444 /etc/systemd/system/tr-.service.d/y.conf",    // prefix drop-in
		"F unit 302 1700000000 5555555555555555 /etc/systemd/system/service.d/z.conf",        // type-wide drop-in
		"F unit 108 1700000000 3030303030303030 /usr/lib/systemd/system/web.service",
		// web.service.d/limits.conf removed
		"F unit 400 1700000000 6666666666666666 /etc/systemd/system/alias.service",
		"F tool 12 1700000000 cccccccccccccccc /usr/bin/awk",
		"F cron 10 1700000000 aaaaaaaaaaaaaaaa /etc/cron.d/e2scrub_all",
		"N tr-sync.service", "N nginx.service", "N getty@tty1.service", "N tr-x.service",
		"N web.service", "N run-u7.service", "N real.service",
		"P real.service /etc/systemd/system/alias.service", // fragment under another name
		"A fstrim.timer", "T fstrim.timer fstrim.service",
		"A logrotate.timer", // enabled at Ready (e.g. started by a reboot)
		"A tr-poll.timer",   // started after Ready
		"A run-u7.timer",    // transient, reported by the script
		"A backup.timer", "T backup.timer backup.service",
		"Z done",
	}
	out := mlines(freeze...)
	got := compareNode(ready, "i-1", out)
	eqList(t, "units", got, []string{
		"vm1: tr-sync.service (unit file differs from the Ready snapshot: /etc/systemd/system/service.d/z.conf)",
		"vm1: nginx.service (unit file differs from the Ready snapshot: /etc/systemd/system/service.d/z.conf)",
		"vm1: getty@tty1.service (unit file differs from the Ready snapshot: /etc/systemd/system/getty@.service.d/x.conf)",
		"vm1: tr-x.service (unit file differs from the Ready snapshot: /etc/systemd/system/service.d/z.conf)",
		"vm1: web.service (unit file differs from the Ready snapshot: /etc/systemd/system/service.d/z.conf)",
		"vm1: real.service (unit file differs from the Ready snapshot: /etc/systemd/system/alias.service)",
		"vm1: fstrim.timer (triggers fstrim.service: /etc/systemd/system/service.d/z.conf differs from the Ready snapshot)",
		"vm1: backup.timer (triggers backup.service: /etc/systemd/system/service.d/z.conf differs from the Ready snapshot)",
		"vm1: tr-poll.timer (started after Ready)",
	})
	eqList(t, "script", stillRunning("vm1", out), []string{"vm1: run-u7.service", "vm1: run-u7.timer"})

	// Without the type-wide drop-in each unit names its own change.
	var noTypeWide []string
	for _, l := range freeze {
		if !strings.Contains(l, "service.d/z.conf") {
			noTypeWide = append(noTypeWide, l)
		}
	}
	got = compareNode(ready, "i-1", mlines(noTypeWide...))
	eqList(t, "units without service.d", got, []string{
		"vm1: tr-sync.service (unit file differs from the Ready snapshot: /etc/systemd/system/tr-.service.d/y.conf)",
		"vm1: getty@tty1.service (unit file differs from the Ready snapshot: /etc/systemd/system/getty@.service.d/x.conf)",
		"vm1: tr-x.service (unit file differs from the Ready snapshot: /etc/systemd/system/tr-.service.d/y.conf)",
		"vm1: web.service (unit file differs from the Ready snapshot: /etc/systemd/system/web.service.d/limits.conf)",
		"vm1: real.service (unit file differs from the Ready snapshot: /etc/systemd/system/alias.service)",
		"vm1: backup.timer (triggers backup.service: /usr/lib/systemd/system/backup.service differs from the Ready snapshot)",
		"vm1: tr-poll.timer (started after Ready)",
	})
}

// #394 item 5: missing or partial freeze output is never a pass.
func TestCompareWithReadyMissingOutput(t *testing.T) {
	ready := ref(t, "i-1", readyUnits...)
	eqList(t, "empty", compareNode(ready, "i-1", ""), []string{
		"vm1: freeze measurements missing or incomplete (not checked)",
		"vm1: unit files not measured at the freeze (not checked)",
		"vm1: cron files not measured at the freeze (not checked)",
		"vm1: tool files not measured at the freeze (not checked)",
	})
	got := compareNode(ready, "i-1", mlines("W cron", "F unit 101 1700000000 bbbbbbbbbbbbbbbb /usr/lib/systemd/system/nginx.service", "F cron 10 1700000000 aaaaaaaaaaaaaaaa /etc/cron.d/e2scrub_all", "Z done"))
	eqList(t, "tool gone, newline name", got, []string{
		"vm1: cron files with a newline in their path (not measured)",
		"vm1: tool files not measured at the freeze (not checked)",
	})
	got = compareNode(ready, "i-1", mlines("F tool 13 1700000000 dddddddddddddddd /usr/bin/sh", "Z done"))
	eqList(t, "awk gone", got[len(got)-2:], []string{
		"vm1: tool /usr/bin/sh (changed since Ready; the freeze results of this node are not reliable)",
		"vm1: tool /usr/bin/awk (missing at the freeze; the freeze results of this node are not reliable)",
	})
	for why, v := range map[string]string{"no Ready-time snapshot": "", "the node could not be measured at Ready": snapshotUnavailable, "the Ready-time snapshot was over its size budget": snapshotTooLarge} {
		r, w, err := decodeSnapshot(v)
		if r != nil || err != nil || w != why {
			t.Errorf("%q: %v %q %v", v, r, w, err)
		}
		got := compareWithReady("vm1", nil, w, "", parseMeasurement(mlines("Z done")), nil)
		eqList(t, "no snapshot", got, []string{"vm1: unit files, cron/at jobs and tools not compared (" + why + ")"})
	}
}

// #394 items 9 and 13: after a reboot, or on a resumed/replaced instance,
// files are compared by content only, reported once, not per file.
func TestCompareWithReadyRebootAndInstance(t *testing.T) {
	ready := ref(t, "i-1", readyUnits...)
	var moved []string
	for _, l := range readyUnits {
		if strings.HasPrefix(l, "F ") {
			f := strings.Fields(l)
			moved = append(moved, fmt.Sprintf("F %s 9%s 1800000000 %s %s", f[1], f[2], f[4], f[5])) // new inode and ctime, same content
		}
	}
	moved = append(moved, "N nginx.service", "A fstrim.timer", "Z done")
	eqList(t, "instance", compareNode(ready, "i-2", mlines(moved...)),
		[]string{"vm1: node instance changed since the Ready snapshot (resumed or replaced): files compared by content only"})
	eqList(t, "rebooted", compareNode(ready, "i-1", mlines(append(moved, "B rebooted")...)),
		[]string{"vm1: rebooted after Ready: files compared by content only; processes and containers not checked"})
	eqList(t, "same instance, new inodes", compareNode(ready, "i-1", mlines(moved...)), []string{
		"vm1: nginx.service (unit file differs from the Ready snapshot: /usr/lib/systemd/system/nginx.service)",
		"vm1: cron /etc/cron.d/e2scrub_all (new or changed since Ready)",
		"vm1: tool /usr/bin/awk (changed since Ready; the freeze results of this node are not reliable)",
	})
	// Render: same instance -> uptime and boot id of the snapshot.
	r := ref(t, "i-1", "B 0b1c-2d 1234", "F tool 1 2 abababababababab /usr/bin/conmon", "F tool 1 2 cdcdcdcdcdcdcdcd /usr/bin/containerd-shim-runc-v2", "F tool 1 2 efefefefefefefef /usr/bin/awk")
	if p := r.freezeParams(90, "i-1"); p.readyUp != 1234 || p.bootID != "0b1c-2d" || p.rtbins != "abababababababab cdcdcdcdcdcdcdcd" || p.since != 90 {
		t.Errorf("params %+v", p)
	}
	if p := r.freezeParams(90, "i-2"); p.readyUp != -1 || p.bootID != "" || p.rtbins == "" {
		t.Errorf("params after a new instance %+v", p)
	}
	if p := (*readyRef)(nil).freezeParams(5, ""); p.readyUp != -1 || p.rtbins != "" {
		t.Errorf("params without snapshot %+v", p)
	}
	s := renderRevoke(freezeParams{since: 5, readyUp: 7, bootID: "ab-12'; rm -rf /", rtbins: "aa bb"})
	if !strings.Contains(s, "since=5\nreadyup=7\nreadyboot='ab-12-f'\nrtbins=' aa bb '\n") || strings.Contains(s, "@SINCE@") {
		t.Errorf("render: %q", s[:120])
	}
}

// #394 item 4: cron and at jobs scheduled after Ready, containers started
// with podman or docker after Ready, and replaced tools are reported.
func TestCompareWithReadyCronContainersTools(t *testing.T) {
	ready := ref(t, "",
		"F cron 10 1700000000 aaaaaaaaaaaaaaaa /etc/cron.d/e2scrub_all",
		"F cron 11 1700000000 bbbbbbbbbbbbbbbb /var/spool/cron/root",
		"F cron 15 1700000000 bbbbbbbbbbbbbbbb /var/spool/cron/svc",
		"F tool 12 1700000000 cccccccccccccccc /usr/bin/awk",
		"F tool 13 1700000000 dddddddddddddddd /usr/bin/conmon",
	)
	out := mlines(
		"F cron 10 1700000000 aaaaaaaaaaaaaaaa /etc/cron.d/e2scrub_all",
		"F cron 11 1700000900 1234123412341234 /var/spool/cron/root",       // sudo crontab -e
		"F cron 20 1700000900 4444444444444444 /var/spool/cron/learner",    // crontab -e
		"F cron 21 1700000900 5555555555555555 /var/spool/cron/atjobs/a01", // at now + 5 min (Debian)
		"F cron 22 1700000900 6666666666666666 /var/spool/at/a0002301a",    // (EL)
		// /var/spool/cron/svc removed: stops a job, not reported
		"F tool 12 1700000000 cccccccccccccccc /usr/bin/awk",
		"F tool 13 1700000999 dddddddddddddddd /usr/bin/conmon", // replaced (same content, new ctime)
		"F tool 14 1700000999 7777777777777777 /usr/sbin/awk",   // a new awk ahead in PATH
		"R 4100 1 podman 0123456789abcdef0123",
		"R 4200 1 moby fedcba9876543210",
		"R 4300 1 k8s.io aaaabbbbccccdddd", // a pod: not a learner container
		"R 4400 0 podman 1111222233334444", // from setup
		"X 4500 1 /run/containers/storage/overlay-containers/9999/userdata/conmon.pid",
		"X 4600 0 /run/containerd/io.containerd.runtime.v2.task/moby/8888/shim.pid", // stale pid file, pid reused before Ready
		"R 4100 1 podman 0123456789abcdef0123",                                      // duplicate line
		"F broken line",
		"Z done",
	)
	eqList(t, "cron/containers/tools", compareNode(ready, "", out), []string{
		"vm1: tool /usr/bin/conmon (changed since Ready; the freeze results of this node are not reliable)",
		"vm1: tool /usr/sbin/awk (changed since Ready; the freeze results of this node are not reliable)",
		"vm1: at job /var/spool/at/a0002301a (queued after Ready)",
		"vm1: at job /var/spool/cron/atjobs/a01 (queued after Ready)",
		"vm1: cron /var/spool/cron/learner (new or changed since Ready)",
		"vm1: cron /var/spool/cron/root (new or changed since Ready)",
		"vm1: container podman 0123456789ab (started after Ready, runtime pid 4100)",
		"vm1: container moby fedcba987654 (started after Ready, runtime pid 4200)",
		"vm1: pid file /run/containers/storage/overlay-containers/9999/userdata/conmon.pid names process 4500, which is not its container runtime",
	})
}

// #394 item 4 (and review items 6, 7): cluster CronJobs created or changed
// after Ready (and not suspended), Jobs started after Ready that still run;
// no answer is never a pass.
func TestCompareCluster(t *testing.T) {
	ready := ref(t, "i-c",
		"F tool 1 2 abababababababab /usr/local/bin/kubectl",
		"F tool 3 4 cdcdcdcdcdcdcdcd /etc/cloudtrain/kubeconfigs/core-admin.conf",
		"K cronjob u-setup g=1 s= default/report",
		"K cronjob u-paused g=2 s=true ops/paused",
		"K job u-old a=1 default/migrate c= m=kubectl-client-side-apply",
		"K ok", "Z done",
	)
	jobs := []string{
		"F tool 1 2 abababababababab /usr/local/bin/kubectl",
		"F tool 3 4 cdcdcdcdcdcdcdcd /etc/cloudtrain/kubeconfigs/core-admin.conf",
		"K cronjob u-setup g=1 s= default/report",                                               // unchanged
		"K cronjob u-paused g=3 s=true ops/paused",                                              // changed, still suspended
		"K cronjob u-new g=1 s=false default/learner-cron",                                      // created after Ready
		"K cronjob u-edit g=2 s= default/edited",                                                // a different uid than at Ready
		"K job u-old a=1 default/migrate c= m=kubectl-client-side-apply",                        // from setup
		"K job u-run a=1 default/learner-job c= m=kubectl-create",                               // kubectl create job
		"K job u-done a= default/done c= m=kubectl-create",                                      // finished
		"K job u-sched a=1 default/report-29001 c=u-setup m=kube-controller-manager",            // the unchanged setup CronJob's
		"K job u-forged a=1 default/report-x c=u-setup m=kubectl-create",                        // owner reference forged
		"K job u-forged2 a=1 default/report-y c=u-setup m=kube-controller-manager kubectl-edit", // edited since
		"K job u-sched2 a=1 default/learner-cron-1 c=u-new m=kube-controller-manager",           // the learner's CronJob's
	}
	got := compareCluster("core", ready, "", "i-c", parseMeasurement(mlines(append(jobs, "K ok", "Z done")...)))
	eqList(t, "cluster", got, []string{
		"core: cronjob default/learner-cron (created or changed after Ready)",
		"core: cronjob default/edited (created or changed after Ready)",
		"core: job default/learner-job (started after Ready, still running)",
		"core: job default/report-x (started after Ready, still running)",
		"core: job default/report-y (started after Ready, still running)",
		"core: job default/learner-cron-1 (started after Ready, still running)",
	})
	eqList(t, "no K lines", compareCluster("core", ready, "", "i-c", parseMeasurement(mlines("Z done"))), []string{
		"core: cluster CronJobs and Jobs not checked (the API did not answer at the freeze)",
		"core: tool files not measured at the freeze (not checked)",
	})
	got = compareCluster("core", ready, "", "i-c", parseMeasurement(mlines("F tool 9 9 9999999999999999 /usr/local/bin/kubectl",
		"F tool 3 4 cdcdcdcdcdcdcdcd /etc/cloudtrain/kubeconfigs/core-admin.conf", "K ok", "Z done")))
	eqList(t, "fake kubectl", got, []string{"core: tool /usr/local/bin/kubectl (changed since Ready; the freeze results of this node are not reliable)"})
	eqList(t, "no snapshot", compareCluster("core", nil, "no Ready-time snapshot", "", parseMeasurement(mlines("K ok", "Z done"))),
		[]string{"core: cluster CronJobs and Jobs not compared (no Ready-time snapshot)"})
	eqList(t, "replaced", compareCluster("core", ready, "", "i-d", parseMeasurement(mlines(append(jobs, "K ok", "Z done")...))),
		[]string{"core: cluster replaced since the Ready snapshot: CronJobs and Jobs not compared"})
}

func TestReportAndSnapshotBounds(t *testing.T) {
	var in []string
	for i := 0; i < 120; i++ {
		in = append(in, fmt.Sprintf("vm%d: %s", i, strings.Repeat("x", 1000)))
	}
	out := capReport(in)
	if len(out) != maxReportEntries+1 || out[maxReportEntries] != "... and 70 more" || len(out[0]) != maxReportLine {
		t.Errorf("capReport: %d entries, last %q, first %d bytes", len(out), out[len(out)-1], len(out[0]))
	}
	if capReport(nil) != nil {
		t.Error("empty report must stay nil")
	}
	m := map[string]string{"a": strings.Repeat("a", maxSnapshotNode+1), "b": strings.Repeat("b", 300<<10), "c": strings.Repeat("c", 250<<10), "d": strings.Repeat("d", 200<<10), "e": "small"}
	capSnapshot(m)
	total := 0
	for _, v := range m {
		total += len(v)
	}
	if m["a"] != snapshotTooLarge || total > maxSnapshotTotal || m["e"] != "small" {
		t.Errorf("capSnapshot: a=%.10q total %d e=%q", m["a"], total, m["e"])
	}
}

func TestNeedsReadySnapshot(t *testing.T) {
	now := metav1.Now()
	exam := func(mut func(*labsv1.LabSession)) *labsv1.LabSession {
		s := &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{labsv1.LabelExamSession: "es1"}}}
		mut(s)
		return s
	}
	for _, c := range []struct {
		name string
		s    *labsv1.LabSession
		want bool
	}{
		{"exam, first Ready", exam(func(*labsv1.LabSession) {}), true},
		{"plain lab", &labsv1.LabSession{}, false},
		{"taken", exam(func(s *labsv1.LabSession) { s.Status.ReadySnapshot = map[string]string{"vm": "-"} }), false},
		{"after a reset (endpoints withdrawn)", exam(func(s *labsv1.LabSession) { s.Status.ReadyAt = &now }), true},
		{"Ready before the snapshot existed", exam(func(s *labsv1.LabSession) {
			s.Status.ReadyAt = &now
			s.Status.Endpoints = []labsv1.Endpoint{{Node: "entry"}}
		}), false},
		{"frozen", exam(func(s *labsv1.LabSession) { s.Spec.AccessRevoked = true }), false},
	} {
		if got := needsReadySnapshot(c.s); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
}

// fakeNode is a node's filesystem, /proc and /run under a temp dir, with a
// fake systemctl, for running the rendered scripts end to end.
type fakeNode struct {
	t                     *testing.T
	root, proc, run, bin  string
	units                 map[string]string // systemctl show answers: "unit prop" -> value
	active, timers, files []string
}

func newFakeNode(t *testing.T) *fakeNode {
	for _, tool := range []string{"sh", "awk", "stat", "sha256sum", "find", "head", "tr", "cut", "getconf"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " not installed")
		}
	}
	d := t.TempDir()
	n := &fakeNode{t: t, root: d + "/root", proc: d + "/proc", run: d + "/root/run", bin: d + "/bin", units: map[string]string{}}
	n.write(n.proc+"/uptime", "5000.12 100.0\n")
	n.write(n.proc+"/sys/kernel/random/boot_id", "0b1c2d3e-aaaa-bbbb-cccc-0123456789ab\n")
	if err := os.MkdirAll(n.root+"/run/systemd/system", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("usr/lib", n.root+"/lib"); err != nil {
		t.Fatal(err)
	}
	return n
}

func (n *fakeNode) write(p, body string) string {
	n.t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		n.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o755); err != nil {
		n.t.Fatal(err)
	}
	return p
}

// systemctl writes the fake systemctl from the current unit state.
func (n *fakeNode) systemctl() {
	var b strings.Builder
	b.WriteString("case \"$*\" in\n")
	b.WriteString("*list-units*--type=timer,path,socket*) printf '%s\\n' " + quoteAll(n.timers) + " ;;\n")
	b.WriteString("*list-units*--type=service*) printf '%s\\n' " + quoteAll(n.active) + " ;;\n")
	b.WriteString("*list-unit-files*) ;;\n")
	for k, v := range n.units {
		f := strings.Fields(k)
		fmt.Fprintf(&b, "\"show -p %s --value %s\") printf '%%s\\n' '%s' ;;\n", f[1], f[0], v)
	}
	b.WriteString("esac\n")
	// The answers live in a data file: the fake binary itself stays as it
	// was measured at Ready.
	n.write(filepath.Dir(n.bin)+"/systemctl.state", b.String())
	n.write(n.bin+"/systemctl", "#!/bin/sh\n. '"+filepath.Dir(n.bin)+"/systemctl.state'\n")
}

func quoteAll(v []string) string {
	if len(v) == 0 {
		return "''"
	}
	return "'" + strings.Join(v, "' '") + "'"
}

// proc adds a fake process: pid, ppid, start time (ticks), cgroup, comm and
// optionally an executable.
func (n *fakeNode) proc1(pid, ppid, start int, cgroup, comm, exe string) {
	d := fmt.Sprintf("%s/%d", n.proc, pid)
	n.write(d+"/stat", fmt.Sprintf("%d (%s) S %d 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %d 0 0\n", pid, comm, ppid, start))
	n.write(d+"/cgroup", "0::"+cgroup+"\n")
	n.write(d+"/status", fmt.Sprintf("PPid:\t%d\nUid:\t0\t0\t0\t0\n", ppid))
	if exe != "" {
		if err := os.Symlink(exe, d+"/exe"); err != nil {
			n.t.Fatal(err)
		}
	}
}

func (n *fakeNode) localize(script string) string {
	n.t.Helper()
	r := strings.NewReplacer(
		"u=learner\n", "u=ct-test-no-such-user-394\n",
		"PROC=/proc\n", "PROC='"+n.proc+"'\n",
		"RUN=/run\n", "RUN='"+n.run+"'\n",
		"ROOT=''\n", "ROOT='"+n.root+"'\n",
		"PATH=/usr/sbin:/usr/bin:/sbin:/bin\n", "PATH='"+n.bin+"':/usr/sbin:/usr/bin:/sbin:/bin\n",
	)
	out := r.Replace(script)
	if strings.Contains(out, "PROC=/proc\n") || strings.Contains(out, "ROOT=''\n") || strings.Contains(out, "u=learner\n") {
		n.t.Fatal("script not localised")
	}
	return out
}

func (n *fakeNode) sh(script string) string {
	n.t.Helper()
	out, err := exec.Command("sh", "-c", n.localize(script)).CombinedOutput()
	if err != nil {
		n.t.Fatalf("%v\n%s", err, out)
	}
	return strings.ReplaceAll(string(out), n.root, "")
}

// #394 end to end: ReadySnapshotScript and the rendered RevokeScript run
// against a fake root (unit, cron and at files), /proc and /run, and the
// controller's comparison of their output. Covers the review findings:
// pid files are parsed (item 1), a forged conmon is rejected (2), drop-ins
// with spaces and files with newlines in their names (3).
func TestFreezeScriptsEndToEnd(t *testing.T) {
	n := newFakeNode(t)
	r := n.root
	n.write(r+"/etc/systemd/system/tr-sync.service", "[Service]\nExecStart=/bin/true\n")
	n.write(r+"/usr/lib/systemd/system/nginx.service", "[Service]\nExecStart=/usr/sbin/nginx\n")
	n.write(r+"/usr/lib/systemd/system/nginx.service.d/my limits.conf", "[Service]\nLimitNOFILE=1024\n")
	n.write(r+"/usr/lib/systemd/system/backup.service", "[Service]\nExecStart=/bin/true\n")
	n.write(r+"/usr/lib/systemd/system/backup.timer", "[Timer]\nOnCalendar=hourly\n")
	n.write(r+"/etc/systemd/system/multi-user.target.wants/nginx.service", "ignored\n")
	n.write(r+"/etc/cron.d/e2scrub_all", "10 3 * * 0 root e2scrub_all\n")
	n.write(r+"/var/spool/at/.SEQ", "1\n")
	conmon := n.write(r+"/usr/bin/conmon", "real conmon binary\n")
	shim := n.write(r+"/usr/bin/containerd-shim-runc-v2", "real shim binary\n")
	n.timers = []string{"backup.timer"}
	n.systemctl()

	snapOut := n.sh(ReadySnapshotScript)
	enc, err := encodeSnapshot(snapOut, "i-1")
	if err != nil {
		t.Fatal(err)
	}
	ready, _, err := decodeSnapshot(enc)
	if err != nil || ready == nil {
		t.Fatal(err)
	}
	if !ready.systemd || ready.bootID != "0b1c2d3e-aaaa-bbbb-cccc-0123456789ab" || ready.uptime != 5000 || !ready.triggers["backup.timer"] {
		t.Fatalf("snapshot: %+v\n%s", ready, snapOut)
	}
	for _, p := range []string{"/usr/lib/systemd/system/nginx.service.d/my_limits.conf", "/etc/cron.d/e2scrub_all", "/usr/bin/conmon", "/usr/bin/containerd-shim-runc-v2"} {
		if _, ok := ready.files[p]; !ok {
			t.Errorf("snapshot lacks %s:\n%s", p, snapOut)
		}
	}
	if _, ok := ready.files["/etc/systemd/system/multi-user.target.wants/nginx.service"]; ok {
		t.Error("enablement links are not unit files")
	}

	// The candidate's work after Ready.
	time.Sleep(10 * time.Millisecond)
	n.write(r+"/usr/lib/systemd/system/nginx.service.d/my limits.conf", "[Service]\nExecStartPost=/bin/sh -c 'loop &'\n")
	n.write(r+"/usr/lib/systemd/system/backup.service", "[Service]\nExecStart=/bin/sh -c 'echo PASS > /answer'\n")
	n.write(r+"/var/spool/cron/crontabs/root", "* * * * * echo PASS > /answer\n")
	n.write(r+"/var/spool/at/a0001", "echo PASS > /answer\n")
	n.write(r+"/etc/cron.d/evil\nname", "* * * * * root true\n")
	n.active = []string{"nginx.service", "tr-sync.service"}
	n.units["nginx.service ActiveEnterTimestampMonotonic"] = "5100000000" // restarted after Ready
	n.units["tr-sync.service ActiveEnterTimestampMonotonic"] = "100"      // since boot
	n.units["nginx.service FragmentPath"] = r + "/usr/lib/systemd/system/nginx.service"
	n.units["backup.timer Triggers"] = "backup.service"
	n.systemctl()
	n.write(n.proc+"/uptime", "5200.00 100.0\n")
	// Container runtimes (ticks: getconf CLK_TCK, Ready at 5000 s).
	hz := 100
	if out, err := exec.Command("getconf", "CLK_TCK").Output(); err == nil {
		fmt.Sscan(string(out), &hz)
	}
	after, before := 5100*hz, 10*hz
	id1, id2, id3, id4, id5 := "a1b2c3d4e5f60718", "b2c3d4e5f6071829", "c3d4e5f60718293a", "d4e5f60718293a4b", "e5f60718293a4b5c"
	fake := n.write(r+"/tmp/conmon", "a copy of sleep\n")
	n.write(n.run+"/containers/storage/overlay-containers/"+id1+"/userdata/conmon.pid", "4100")
	n.proc1(4100, 1, after, "/machine.slice/libpod-conmon-"+id1+".scope", "conmon", conmon) // podman run -d after Ready
	n.proc1(4101, 4100, after, "/machine.slice/libpod-"+id1+".scope", "nginx", "")          // its container
	n.write(n.run+"/containers/storage/overlay-containers/"+id2+"/userdata/conmon.pid", "4200")
	n.proc1(4200, 1, after, "/machine.slice/libpod-conmon-"+id2+".scope", "conmon", fake) // forged: a copy of sleep named conmon
	n.write(n.run+"/containers/storage/overlay-containers/"+id3+"/userdata/conmon.pid", "4300")
	n.proc1(4300, 1, after, "/system.slice/cron.service", "conmon", conmon) // real binary, wrong cgroup
	n.write(n.run+"/containerd/io.containerd.runtime.v2.task/moby/"+id4+"/shim.pid", "4400")
	n.proc1(4400, 1, before, "/system.slice/containerd.service", "containerd-shim", shim) // docker container from setup
	n.proc1(4401, 4400, after, "/system.slice/docker-"+id4+".scope", "worker", "")        // forked after Ready
	n.write(n.run+"/containerd/io.containerd.runtime.v2.task/k8s.io/"+id5+"/shim.pid", "4500")
	n.proc1(4500, 1, after, "/system.slice/containerd.service", "containerd-shim", shim) // a pod
	n.write(n.run+"/containerd/io.containerd.runtime.v2.task/moby/not-hex/shim.pid", "4400")
	n.write(n.run+"/containers/storage/overlay-containers/"+id1+"0/userdata/conmon.pid", "77777") // no such process
	n.proc1(4600, 1, after, "/machine.slice/libpod-"+id1+".scope", "sh", "")                      // a loop moved into the container's scope
	n.proc1(4601, 1, after, "/system.slice/containerd.service", "containerd-shim", "")            // a loop named like a shim

	script := renderRevoke(ready.freezeParams(200, "i-1"))
	out := n.sh(script)
	m := parseMeasurement(out)
	if !m.done || m.rebooted {
		t.Fatalf("freeze output:\n%s", out)
	}
	var rs, xs []string
	for _, x := range m.runtimes {
		rs = append(rs, fmt.Sprintf("%s:%v:%s", x.pid, x.after, x.ns))
	}
	for _, x := range m.strays {
		xs = append(xs, x.pid)
	}
	sortStrings(rs)
	eqList(t, "runtimes", rs, []string{"4100:true:podman", "4400:false:moby", "4500:true:k8s.io"})
	eqList(t, "rejected pid files", xs, []string{"4200", "4300"})
	var procs []string
	for _, l := range strings.Split(out, "\n") {
		if p, ok := strings.CutPrefix(l, revokeNewProcess); ok {
			procs = append(procs, strings.Fields(p)[0])
		}
	}
	sortStrings(procs)
	eqList(t, "new processes", procs, []string{"conmon[4200]", "conmon[4300]", "containerd-shim[4601]", "sh[4600]"})

	got := compareWithReady("vm1", ready, "", "i-1", m, reportedUnits(out))
	eqList(t, "report", got, []string{
		"vm1: cron files with a newline in their path (not measured)",
		"vm1: nginx.service (unit file differs from the Ready snapshot: /usr/lib/systemd/system/nginx.service.d/my_limits.conf)",
		"vm1: backup.timer (triggers backup.service: /usr/lib/systemd/system/backup.service differs from the Ready snapshot)",
		"vm1: at job /var/spool/at/a0001 (queued after Ready)",
		"vm1: cron /var/spool/cron/crontabs/root (new or changed since Ready)",
		"vm1: container podman a1b2c3d4e5f6 (started after Ready, runtime pid 4100)",
		"vm1: pid file /run/containers/storage/overlay-containers/" + id2 + "/userdata/conmon.pid names process 4200, which is not its container runtime",
		"vm1: pid file /run/containers/storage/overlay-containers/" + id3 + "/userdata/conmon.pid names process 4300, which is not its container runtime",
	})

	// The same node after a reboot: no process checks, one line.
	n.write(n.proc+"/sys/kernel/random/boot_id", "ffffffff-aaaa-bbbb-cccc-0123456789ab\n")
	n.write(n.proc+"/uptime", "30.00 1.0\n")
	out = n.sh(script)
	m = parseMeasurement(out)
	if !m.rebooted || strings.Contains(out, revokeNewProcess) {
		t.Errorf("after a reboot:\n%s", out)
	}
	for _, x := range m.runtimes {
		if x.after {
			t.Errorf("after a reboot no runtime counts as started after Ready: %+v", x)
		}
	}
	if !strings.Contains(strings.Join(m.started, " "), "tr-sync.service") {
		t.Errorf("after a reboot every active unit counts as started after Ready: %v", m.started)
	}
}

func sortStrings(v []string) {
	for i := 1; i < len(v); i++ {
		for j := i; j > 0 && v[j] < v[j-1]; j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
}

// The guest scripts pass shellcheck (CI checks repo .sh files, not scripts
// embedded in Go).
func TestFreezeScriptsShellcheck(t *testing.T) {
	if _, err := exec.LookPath("shellcheck"); err != nil {
		t.Skip("shellcheck not installed")
	}
	for name, script := range map[string]string{
		"revoke":  renderRevoke(freezeParams{since: 60, readyUp: 100, bootID: "0b1c-2d", rtbins: "abab cdcd"}),
		"ready":   ReadySnapshotScript,
		"cluster": ClusterSnapshotScript,
	} {
		cmd := exec.Command("shellcheck", "-s", "sh", "-S", "warning", "-")
		cmd.Stdin = strings.NewReader(script)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Errorf("%s: %v\n%s", name, err, out)
		}
		if strings.Contains(script, "%%") || strings.Contains(script, "@SINCE@") {
			t.Errorf("%s: unrendered placeholder or fmt escape", name)
		}
	}
}
