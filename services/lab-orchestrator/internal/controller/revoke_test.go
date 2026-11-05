package controller

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// grading-3: the freeze must also end what the learner started through sudo
// (root processes below a learner process, or in a learner login session),
// and nothing else. Containers and processes running as another account are
// kept (often the graded state); the latter are reported.
func TestRevokeTreeAwk(t *testing.T) {
	if _, err := exec.LookPath("awk"); err != nil {
		t.Skip("awk not installed")
	}
	// pid ppid uid loginuid cgroup
	table := strings.Join([]string{
		"1 0 0 4294967295 /init.scope",                                       // init
		"10 1 0 4294967295 /system.slice/ssh.service",                        // sshd
		"20 10 1000 1000 /user.slice/user-1000.slice/session-3.scope",        // learner shell
		"21 20 0 1000 /user.slice/user-1000.slice/session-3.scope",           // sudo (root, learner session)
		"22 21 0 1000 /user.slice/user-1000.slice/session-3.scope",           // root shell from sudo
		"23 22 0 1000 /user.slice/user-1000.slice/session-3.scope",           // its background job
		"30 1 0 1000 /user.slice/user-1000.slice/session-3.scope",            // daemonised by the learner via sudo setsid (re-parented to init)
		"31 30 0 1000 /user.slice/user-1000.slice/session-3.scope",           // its child
		"40 99 0 4294967295 /user.slice/user-0.slice/session-7.scope",        // child of the revoke script (self=99)
		"50 1 0 4294967295 /system.slice/cron.service",                       // unrelated root daemon
		"51 50 0 4294967295 /system.slice/cron.service",                      // its child
		"60 1 1000 4294967295 /",                                             // learner process without a login session
		"61 60 0 4294967295 /",                                               // root child of it (setuid helper)
		"70 1 0 1000 /machine.slice/libpod-conmon-ab12.scope",                // sudo podman run -d: conmon
		"71 70 0 1000 /machine.slice/libpod-ab12.scope",                      // and the container
		"72 1 0 1000 /system.slice/docker-ab12.scope",                        // root loop moved into a container-looking cgroup at the top
		"80 1 1002 1000 /user.slice/user-1000.slice/session-3.scope",         // sudo -u svc nohup job &
		"81 80 1002 1000 /user.slice/user-1000.slice/session-3.scope",        // its child
		"82 1 101000 1000 /user.slice/user-1002.slice/user@1002.service/x/y", // rootless podman as svc
		"90 1 0 1000 /docker-ab12.scope",                                     // a made-up scope outside any slice
		"99 10 0 0 /user.slice/user-0.slice/session-7.scope",                 // the revoke script itself
	}, "\n") + "\n"
	run := func(mode string) []string {
		t.Helper()
		cmd := exec.Command("awk", "-v", "uid=1000", "-v", "self=99", "-v", "mode="+mode, revokeTreeAwk)
		cmd.Stdin = strings.NewReader(table)
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		got := strings.Fields(string(out))
		sort.Strings(got)
		return got
	}
	want := []string{"20", "21", "22", "23", "30", "31", "60", "61", "90"}
	if got := run("kill"); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("killed %v; want %v", got, want)
	}
	want = []string{"80", "81", "82"}
	if got := run("keep"); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("kept and reported %v; want %v", got, want)
	}
	if !strings.Contains(RevokeScript, revokeTreeAwk) || !strings.Contains(RevokeScript, "loginctl terminate-user") {
		t.Error("RevokeScript must use the tree walk and end the learner's user manager")
	}
	if strings.Contains(revokeTreeAwk, "'") {
		t.Error("revokeTreeAwk is single-quoted in the script and must not contain a single quote")
	}
	if strings.Contains(revokeContainerScope, "[/]") {
		t.Error("busybox awk ends a regex literal at a / inside brackets: write \\/")
	}
}

// The tree must be known before anything dies: stopping first keeps every
// root child of a learner shell attached to its parent; killing first
// re-parents it to PID 1, where (no loginuid under kubectl exec/runuser)
// nothing finds it again.
func TestRevokeScriptStopsBeforeKilling(t *testing.T) {
	s := revokeScript(&labsv1.LabSession{}, time.Now())
	stop := strings.Index(s, "kill -STOP")
	kill := strings.Index(s, "kill -KILL")
	for _, killer := range []string{"kill -KILL", "pkill", "loginctl terminate-user"} {
		if i := strings.Index(s, killer); i < 0 || i < stop || stop < 0 {
			t.Errorf("%q at %d must come after the first kill -STOP (%d)", killer, i, stop)
		}
	}
	if !strings.Contains(s[stop:kill], "for round in 1 2 3") && !strings.Contains(s[:stop], "for round in 1 2 3") {
		t.Error("the stop pass must run in rounds")
	}
	if !strings.HasPrefix(s, "u=learner\nsince=-1\n") {
		t.Errorf("without ReadyAt the script must not report units: %q", s[:30])
	}
	ready := metav1.NewTime(time.Now().Add(-90 * time.Second))
	if s := revokeScript(&labsv1.LabSession{Status: labsv1.LabSessionStatus{ReadyAt: &ready}}, ready.Add(90*time.Second)); !strings.Contains(s, "since=90\n") {
		t.Errorf("since: %q", s[:30])
	}
	if strings.Contains(s, "%!") {
		t.Error("RevokeScript has a stray format verb")
	}
}

func TestStillRunning(t *testing.T) {
	out := "noise\ncloudtrain-revoke: still running: run-u42.service\n  cloudtrain-revoke: still running: tr-loop.service \ncloudtrain-revoke: still running: \ncloudtrain-revoke: new process: sh[77] /\n"
	out += "cloudtrain-revoke: still running: x.service (unit file changed after Ready)\ncloudtrain-revoke: kept: tr-reindex[81] uid=1002\n"
	got := stillRunning("vm1", out)
	if strings.Join(got, ",") != "vm1: run-u42.service,vm1: tr-loop.service,vm1: process sh[77] /,vm1: x.service (unit file changed after Ready),vm1: kept tr-reindex[81] uid=1002" {
		t.Errorf("got %v", got)
	}
}

// #394: a VM whose loginuids are not immutable is reported (the attempt is
// held for review). The controller decides which targets are checked, by
// node kind; the check asks the kernel (EPERM on a loginuid change).
func TestRevokeLoginuidNotLocked(t *testing.T) {
	got := stillRunning("ctl", "cloudtrain-revoke: loginuid not locked\ncloudtrain-revoke: loginuid not locked (state unreadable)\n")
	if len(got) != 2 || !strings.HasPrefix(got[0], "ctl: loginuid not locked (the boot-time lock") || !strings.HasPrefix(got[1], "ctl: loginuid not locked (state unreadable) (") {
		t.Errorf("got %v", got)
	}
	if strings.Contains(RevokeScript, "loginuid not locked") || strings.Contains(revokeLoginuidCheck, "auditctl") || strings.Contains(revokeLoginuidCheck, "/var/lib/cloud") {
		t.Error("the loginuid check must not depend on guest state other than the kernel's")
	}
	spec := &labsv1.LabTemplateSpec{Topology: labsv1.Topology{Entry: "ws", Nodes: []labsv1.Node{
		{Name: "ws", Driver: labsv1.DriverContainer},
		{Name: "vm1", Driver: labsv1.DriverVM},
		{Name: "k", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Mode: labsv1.ClusterModeKubeadm, Nodes: []labsv1.ClusterNode{{Name: "cp"}}}},
	}}}
	var vms []string
	for _, on := range revokeTargets(spec) {
		if revokeOnVM(spec, on) {
			vms = append(vms, on)
		}
	}
	if strings.Join(vms, ",") != "vm1,k/cp" {
		t.Errorf("checked targets %v", vms)
	}
	spec.Topology.Entry = "vm1"
	if !revokeOnVM(spec, "vm1") {
		t.Error("VM entry node not checked")
	}
}

// The check itself, with fake loginuid files: a directory stands for a
// locked loginuid (every write fails), a regular file for a mutable one.
func TestRevokeLoginuidCheckScript(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no sh")
	}
	dir := t.TempDir()
	locked, mutable := filepath.Join(dir, "locked"), filepath.Join(dir, "mutable")
	if err := os.Mkdir(locked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mutable, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{locked: "", mutable: revokeLoginuid, filepath.Join(dir, "none"): revokeLoginuid + " (state unreadable)"} {
		out, err := exec.Command("sh", "-c", strings.ReplaceAll(revokeLoginuidCheck, "/proc/self/loginuid", path)).CombinedOutput()
		if err != nil || strings.TrimSpace(string(out)) != want {
			t.Errorf("%s: %q, %v; want %q", filepath.Base(path), out, err, want)
		}
	}
}

// grading-3: what the tree walk cannot find (a root loop daemonised through
// `sudo setsid -f` where no loginuid is set, or after root rewrote its
// loginuid) is reported when it started after Ready and no unit owns it.
func TestRevokeNewAwk(t *testing.T) {
	if _, err := exec.LookPath("awk"); err != nil {
		t.Skip("awk not installed")
	}
	run := func(sd string, rows ...string) []string {
		t.Helper()
		cmd := exec.Command("awk", "-v", "self=99", "-v", "rt=5000", "-v", "sd="+sd, "-v", "mains= 10 11 17 ", revokeNewAwk)
		cmd.Stdin = strings.NewReader(strings.Join(rows, "\n") + "\n")
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		got := strings.Split(strings.TrimSpace(string(out)), "\n")
		sort.Strings(got)
		if len(got) == 1 && got[0] == "" {
			return nil
		}
		return got
	}
	// pid ppid starttime cgroup comm: no systemd (kubectl-exec entry container).
	got := run("0",
		"1 0 100 / sleep",
		"30 1 4000 / nginx",       // daemon started before Ready
		"40 1 6000 / sh",          // daemonised after Ready: sudo setsid -f sh -c loop
		"41 40 6001 / sleep",      // its child
		"50 0 6000 / sh",          // exec'd from outside the container (platform)
		"51 50 6001 / cat",        // its child
		"98 0 6000 / sh",          // the exec running the revoke script
		"99 98 6000 / sh",         // the revoke script
		"100 99 6002 / awk",       // its pipeline
		"60 1 7000 / evil name x", // comm with spaces
	)
	want := []string{"evil_name_x[60] /", "sh[40] /", "sleep[41] /"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("no systemd: got %v; want %v", got, want)
	}
	// systemd host (VM).
	got = run("1",
		"1 0 100 /init.scope systemd",
		"2 0 100 / kthreadd",
		"3 2 6000 / kworker/0:1",                                     // kernel thread
		"10 1 6000 /system.slice/cron.service cron",                  // unit
		"11 1 6000 /system.slice/run-u42.service sh",                 // transient unit (reported separately)
		"12 25 6000 /system.slice/docker-abc.scope sh",               // container
		"25 1 6000 /system.slice/containerd.service containerd-shim", // its shim (re-parented, not the main process)
		"18 1 6000 /system.slice/cron.service sh",                    // loop moved into cron.service/cgroup.procs
		"19 10 6000 /system.slice/cron.service sh",                   // a cron job
		"26 1 6000 /machine.slice/libpod-conmon-ab12.scope conmon",   // podman's conmon
		"27 26 6000 /machine.slice/libpod-ab12.scope nginx",          // its container
		"28 1 6000 /machine.slice/libpod-ab12.scope sh",              // loop moved into the container's scope
		"29 1 6000 /system.slice/run-r1.scope sh",                    // transient scope (reported as a unit)
		"17 1 6000 /system.slice/systemd-udevd.service/udev udev",    // sub-cgroup of a unit
		"13 1 6000 /user.slice/user-0.slice/session-9.scope sshd",    // another root session
		"14 1 6000 / sh", // moved to the root cgroup
		"15 1 6000 /user.slice/user-1000.slice/session-3.scope sh", // escaped the terminated session
		"16 1 6000 /evil$(x) sh",                                   // learner-made cgroup
		"97 1 6000 /user.slice/user-0.slice/session-7.scope sshd",  // the revoke script's session
		"98 97 6000 /user.slice/user-0.slice/session-7.scope bash",
		"99 98 6000 /user.slice/user-0.slice/session-7.scope sh",
		"20 1 4000 / sh", // before Ready
	)
	want = []string{"sh[14] /", "sh[15] /user.slice/user-1000.slice/session-3.scope", "sh[16] /evil__x_", "sh[18] /system.slice/cron.service", "sh[28] /machine.slice/libpod-ab12.scope", "sshd[13] /user.slice/user-0.slice/session-9.scope"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("systemd: got %v; want %v", got, want)
	}
	s := revokeScript(&labsv1.LabSession{}, time.Now())
	if !strings.Contains(s, revokeNewAwk) || !strings.Contains(s, revokeNewProcess) || strings.Index(s, "sleep 1") < strings.Index(s, "loginctl terminate-user") {
		t.Error("RevokeScript must report new processes, a second after the kill pass")
	}
	if strings.Contains(revokeNewAwk, "'") {
		t.Error("revokeNewAwk is single-quoted in the script and must not contain a single quote")
	}
}

// TestRevokeScriptIT runs the whole RevokeScript in a container where no
// loginuid is set (as under kubectl exec): learner shell -> sudo -> a root
// background loop rewriting an answer. The loop must die. Opt-in
// (CT_REVOKE_IT=1, needs docker and the alpine:3 image).
func TestRevokeScriptIT(t *testing.T) {
	if os.Getenv("CT_REVOKE_IT") != "1" {
		t.Skip("set CT_REVOKE_IT=1 (needs docker) to run the RevokeScript in a container")
	}
	dir := t.TempDir()
	// A minimal sudo: real and effective uid 0, then exec (like sudo, it
	// stays the child of the learner's shell).
	src := `package main
import ("os"; "syscall")
func main() {
	if err := syscall.Setgid(0); err != nil { panic(err) }
	if err := syscall.Setuid(0); err != nil { panic(err) }
	panic(syscall.Exec("/bin/sh", append([]string{"sh"}, os.Args[1:]...), os.Environ()))
}`
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-o", filepath.Join(dir, "fsudo"), filepath.Join(dir, "main.go"))
	build.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS=linux", "GO111MODULE=off")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build fsudo: %v\n%s", err, out)
	}
	name := fmt.Sprintf("ct-revoke-it-%d", time.Now().UnixNano())
	docker := func(args ...string) string {
		t.Helper()
		out, err := exec.Command("docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("docker %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	docker("run", "-d", "--rm", "--name", name, "-v", dir+":/x:ro", "alpine:3", "sleep", "600")
	t.Cleanup(func() { _ = exec.Command("docker", "rm", "-f", name).Run() })
	docker("exec", name, "sh", "-c", "adduser -D -u 1000 learner && adduser -D -u 1002 svc && cp /x/fsudo /usr/local/bin/sudo && chmod 4755 /usr/local/bin/sudo")
	docker("exec", "-d", name, "su", "learner", "-s", "/bin/sh", "-c",
		`sudo -c 'while :; do date +%s%N > /tmp/answer; sleep 0.2; done' & sudo -c 'su svc -s /bin/sh -c "exec sleep 4243"' & while :; do sleep 1; done`)
	loop := func() string {
		return strings.TrimSpace(docker("exec", name, "sh", "-c", `ps -o user,args | awk '$1 == "root" && /[d]ate \+%s%N/'`))
	}
	deadline := time.Now().Add(10 * time.Second)
	for loop() == "" {
		if time.Now().After(deadline) {
			t.Fatalf("the root loop never started: %q", docker("exec", name, "ps", "-o", "pid,ppid,user,args"))
		}
		time.Sleep(200 * time.Millisecond)
	}
	if lu := strings.TrimSpace(docker("exec", name, "cat", "/proc/self/loginuid")); lu != "4294967295" {
		t.Logf("loginuid in the container is %s (expected unset)", lu)
	}
	for strings.TrimSpace(docker("exec", name, "sh", "-c", `pgrep -x -u svc sleep || true`)) == "" {
		if time.Now().After(deadline) {
			t.Fatal("the svc job never started")
		}
		time.Sleep(200 * time.Millisecond)
	}
	out := docker("exec", name, "sh", "-c", revokeScript(&labsv1.LabSession{}, time.Now()))
	// A job the learner started as another account is kept (often the graded
	// state, e.g. sudo -u svc nohup job &) and reported.
	if !strings.Contains(out, revokeKept+"sleep[") || !strings.Contains(out, " uid=1002") {
		t.Errorf("revoke output %q does not report the kept svc job", out)
	}
	if strings.TrimSpace(docker("exec", name, "sh", "-c", `pgrep -x -u svc sleep || true`)) == "" {
		t.Error("the job running as svc was killed")
	}
	if got := loop(); got != "" {
		t.Fatalf("the root loop survived the freeze (%s):\n%s", got, docker("exec", name, "ps", "-o", "pid,ppid,user,stat,args"))
	}
	a := docker("exec", name, "cat", "/tmp/answer")
	time.Sleep(time.Second)
	if b := docker("exec", name, "cat", "/tmp/answer"); a != b {
		t.Error("the answer is still being rewritten after the freeze")
	}
	if ps := docker("exec", name, "sh", "-c", `ps -o user,stat,args | awk '$1 == "learner" && $2 !~ /Z/'`); strings.TrimSpace(ps) != "" {
		t.Errorf("learner processes left (zombies of the container's non-reaping PID 1 aside):\n%s", ps)
	}
}
