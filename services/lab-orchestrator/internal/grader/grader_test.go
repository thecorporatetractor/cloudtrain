package grader

import (
	"time"

	"context"
	"errors"
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func TestMatch(t *testing.T) {
	tests := []struct {
		match, value, out string
		want              bool
	}{
		{"exact", "3", "3\n", true},
		{"exact", "3", "3 \n", false}, // only one trailing newline is stripped
		{"exact", "3", "3\n\n", false},
		{"exact", "a b", "a b\r\n", true},
		{"not_exact", "true", "", true},
		{"not_exact", "true", "true\n", false},
		{"contains", "Ready", "node Ready\n", true},
		{"not_contains", "Ready", "NotReady", false},
		{"regex", `^\["ReadOnlyMany"\]$`, `["ReadOnlyMany"]`, true},
		{"regex", `^1\.35\.2-\S+ 1\.35\.2-\S+ ?$`, "1.35.2-1.1 1.35.2-1.1 ", true},
		{"regex", `^v1\.35`, "v1.36.0", false},
	}
	for _, tt := range tests {
		got, err := Match(&labsv1.Expectation{Match: labsv1.MatchType(tt.match), Value: tt.value}, tt.out)
		if err != nil || got != tt.want {
			t.Errorf("Match(%s %q, %q) = %v, %v; want %v", tt.match, tt.value, tt.out, got, err, tt.want)
		}
	}
	if _, err := Match(&labsv1.Expectation{Match: "regex", Value: "("}, "x"); err == nil {
		t.Error("invalid regex must error")
	}
	// RE2: no backreferences.
	if _, err := Match(&labsv1.Expectation{Match: "regex", Value: `(a)\1`}, "aa"); err == nil {
		t.Error("backreference must be rejected (RE2)")
	}
}

type fakeExec struct {
	calls []string
	reply func(on string, req drivers.ExecRequest) (drivers.ExecResult, error)
}

func (f *fakeExec) Exec(_ context.Context, on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
	f.calls = append(f.calls, on+"|"+string(req.User)+"|"+strings.Join(req.Command, " "))
	return f.reply(on, req)
}

func TestGradeChecks(t *testing.T) {
	port := int32(22)
	checks := []labsv1.Check{
		{ID: "shell", Type: "shell", Command: "echo hi", Weight: "2", Expect: &labsv1.Expectation{Match: "exact", Value: "hi"}},
		{ID: "query", Type: "k8s-query", Query: &labsv1.CheckQuery{Cluster: "c1", Resource: "node", Name: "n1", JSONPath: "{.spec.unschedulable}"},
			Expect: &labsv1.Expectation{Match: "exact", Value: "true"}},
		{ID: "missing", Type: "k8s-query", Query: &labsv1.CheckQuery{Cluster: "c1", Resource: "pv", Name: "gone", JSONPath: "{.metadata.name}"},
			Expect: &labsv1.Expectation{Match: "exact", Value: "gone"}},
		{ID: "cani", Type: "k8s-can-i", Query: &labsv1.CheckQuery{Cluster: "c1", Verb: "delete", Resource: "pods", Namespace: "ns", As: "system:serviceaccount:ns:sa"},
			Expect: &labsv1.Expectation{Match: "exact", Value: "no"}},
		{ID: "ctx", Type: "k8s-context", On: "ws", Expect: &labsv1.Expectation{Match: "exact", Value: "c1"}},
		{ID: "svc", Type: "service-state", On: "vm1", Target: "etcd.service"},
		{ID: "file", Type: "file", On: "vm1", Target: "/etc/x", Expect: &labsv1.Expectation{Match: "contains", Value: "secret-value"}},
		{ID: "reach", Type: "reachability", Target: "vm1", Port: &port},
		{ID: "slow", Type: "shell", Command: "sleep 99"},
		{ID: "dev", Type: "device-cmd", Command: "show ip route"},
	}
	f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		cmd := strings.Join(req.Command, " ")
		switch {
		case strings.Contains(cmd, "echo hi"):
			return drivers.ExecResult{Stdout: "hi\n"}, nil
		case strings.Contains(cmd, "get node n1"):
			return drivers.ExecResult{Stdout: "true"}, nil
		case strings.Contains(cmd, "get pv gone"):
			return drivers.ExecResult{Stderr: `Error from server (NotFound): persistentvolumes "gone" not found`, ExitCode: 1}, nil
		case strings.Contains(cmd, "auth can-i"):
			return drivers.ExecResult{Stdout: "no\n", ExitCode: 1}, nil
		case strings.Contains(cmd, "current-context"):
			return drivers.ExecResult{Stdout: "c1\n"}, nil
		case strings.Contains(cmd, "is-active"):
			return drivers.ExecResult{Stdout: "inactive\n", ExitCode: 3}, nil
		case strings.Contains(cmd, "cat --"):
			return drivers.ExecResult{Stdout: "the secret-value here"}, nil
		case strings.Contains(cmd, "/dev/tcp"):
			return drivers.ExecResult{Stdout: "reachable\n"}, nil
		case req.Kind == ExecDeviceCommand:
			return drivers.ExecResult{}, errors.New("netdev: " + drivers.ErrUnsupported.Error())
		case strings.Contains(cmd, "sleep 99"):
			return drivers.ExecResult{ExitCode: 124}, nil
		}
		return drivers.ExecResult{}, errors.New("unexpected " + cmd)
	}}
	g := &Grader{Exec: f, Entry: "ws"}
	score, res := g.Grade(context.Background(), checks)
	want := map[string]bool{"shell": true, "query": true, "missing": false, "cani": true, "ctx": true, "svc": false, "file": true, "reach": true, "slow": false, "dev": false}
	for _, r := range res {
		if r.Passed != want[r.ID] {
			t.Errorf("%s passed=%v want %v (%s, %q)", r.ID, r.Passed, want[r.ID], r.Message, r.Output)
		}
		if strings.Contains(r.Message, "secret-value") || strings.Contains(r.Message, "true") {
			t.Errorf("%s: message leaks values: %q", r.ID, r.Message)
		}
	}
	// weights: shell 2, others 1 -> total 11, passed 2+1+1+1+1+1 = 7 -> 64
	if score != 64 {
		t.Errorf("score = %d, want 64", score)
	}
	byID := map[string]labsv1.CheckResult{}
	for _, r := range res {
		byID[r.ID] = r
	}
	if byID["slow"].Message != MsgTimeout {
		t.Errorf("slow message = %q", byID["slow"].Message)
	}
	if byID["dev"].Message != MsgError {
		t.Errorf("dev message = %q", byID["dev"].Message)
	}
	// Routing: shell defaults to the entry node, k8s-query to the cluster,
	// k8s-context runs as the learner.
	joined := strings.Join(f.calls, "\n")
	for _, w := range []string{"ws|admin|timeout -k 2 30 /bin/sh -c echo hi", "c1|admin|timeout -k 2 20 kubectl get node n1 -o jsonpath={.spec.unschedulable}",
		"ws|learner|timeout -k 2 20 kubectl config current-context", "c1|admin|timeout -k 2 20 kubectl auth can-i delete pods -n ns --as system:serviceaccount:ns:sa"} {
		if !strings.Contains(joined, w) {
			t.Errorf("missing call %q in\n%s", w, joined)
		}
	}
}

func TestScoreAndTruncate(t *testing.T) {
	if Score(0, 0) != 0 || Score(1, 3) != 33 || Score(2, 3) != 67 {
		t.Error("score rounding")
	}
	long := strings.Repeat("é", 2000)
	got := truncate(long)
	if len(got) > MaxOutput || !strings.HasSuffix(got, "[truncated]") {
		t.Errorf("truncate len %d", len(got))
	}
}

func TestDefaultTimeouts(t *testing.T) {
	for _, tc := range []struct {
		c    labsv1.Check
		want time.Duration
	}{
		{labsv1.Check{Type: "shell"}, DefaultShellTimeout},
		{labsv1.Check{Type: "file"}, DefaultTimeout},
		{labsv1.Check{Type: "k8s-query"}, DefaultK8sTimeout},
		{labsv1.Check{Type: "k8s-can-i"}, DefaultK8sTimeout},
		{labsv1.Check{Type: "k8s-context"}, DefaultK8sTimeout},
		{labsv1.Check{Type: "http"}, DefaultTimeout},
		{labsv1.Check{Type: "k8s-query", TimeoutSec: 3}, 3 * time.Second},
		{labsv1.Check{Type: "shell", TimeoutSec: 7}, 7 * time.Second},
		{labsv1.Check{Type: "shell", TimeoutSec: 9999}, MaxTimeout},
	} {
		if got := timeoutOf(tc.c); got != tc.want {
			t.Errorf("timeoutOf(%s, %d) = %v, want %v", tc.c.Type, tc.c.TimeoutSec, got, tc.want)
		}
	}
}

// A host that refuses the grader's ssh login fails every check with a clear
// message, even a check that expects empty output.
func TestGradeNoHostAccess(t *testing.T) {
	checks := []labsv1.Check{
		{ID: "empty", Type: "shell", On: "vm1", Command: "find / -perm -0002 -type f", Expect: &labsv1.Expectation{Match: "exact", Value: ""}},
		{ID: "svc", Type: "service-state", On: "vm1", Target: "ssh"},
	}
	f := &fakeExec{reply: func(string, drivers.ExecRequest) (drivers.ExecResult, error) {
		return drivers.ExecResult{Stderr: "root@192.168.100.10: Permission denied (publickey).\n", ExitCode: 255, NoHostAccess: true}, nil
	}}
	_, res := (&Grader{Exec: f, Entry: "ws"}).Grade(context.Background(), checks)
	for _, r := range res {
		if r.Passed || r.Message != MsgNoHostAccess || !strings.Contains(r.Output, "Permission denied") {
			t.Errorf("%s: passed=%v message=%q output=%q", r.ID, r.Passed, r.Message, r.Output)
		}
	}
}

// content-10: only the API server's NotFound reads as an empty result; any
// other "not found" (context, kubeconfig, binary) is an error, so an
// "expect empty" check cannot pass on it.
func TestK8sQueryNotFoundIsServerOnly(t *testing.T) {
	empty := &labsv1.Expectation{Match: "exact", Value: ""}
	for stderr, wantPass := range map[string]bool{
		`Error from server (NotFound): deployments.apps "x" not found`: true,
		`error: context "qm" not found`:                                false,
		`sh: 1: kubectl: not found`:                                    false,
		`error: stat /root/.kube/c.conf: no such file or directory`:    false,
		// The server's NotFound for a whole API type (missing group, deleted CRD).
		`Error from server (NotFound): the server could not find the requested resource`: false,
	} {
		f := &fakeExec{reply: func(string, drivers.ExecRequest) (drivers.ExecResult, error) {
			return drivers.ExecResult{Stderr: stderr, ExitCode: 1}, nil
		}}
		g := &Grader{Exec: f, Entry: "ws"}
		_, res := g.Grade(context.Background(), []labsv1.Check{{ID: "q", Type: "k8s-query", Query: &labsv1.CheckQuery{Cluster: "c", Resource: "deployment", Name: "x", JSONPath: "{.spec}"}, Expect: empty}})
		if res[0].Passed != wantPass {
			t.Errorf("%q: passed=%v, want %v (%s)", stderr, res[0].Passed, wantPass, res[0].Message)
		}
	}
}

// A shell check with inputs reads each learner file as the learner on its
// node, then runs the command (as admin, on the check's node) with the
// contents in its environment.
func TestShellInputs(t *testing.T) {
	c := labsv1.Check{ID: "cmp", Type: "shell", On: "c1", Command: `[ "$GOT" = 31000 ] && echo match`,
		Inputs: []labsv1.CheckInput{{Name: "GOT", On: "ws", File: "/home/learner/a.txt"}, {Name: "GONE", File: "/home/learner/none"}},
		Expect: &labsv1.Expectation{Match: "exact", Value: "match"}}
	var main drivers.ExecRequest
	f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		cmd := strings.Join(req.Command, " ")
		switch {
		case strings.Contains(cmd, "/home/learner/a.txt"):
			if on != "ws" || req.User != labsv1.ActionAsLearner {
				t.Errorf("input read on %s as %s; want ws as learner", on, req.User)
			}
			return drivers.ExecResult{Stdout: "31000\n"}, nil
		case strings.Contains(cmd, "/home/learner/none"):
			if on != "entry" {
				t.Errorf("input without on read on %s; want the entry node", on)
			}
			return drivers.ExecResult{ExitCode: 3}, nil
		}
		main = req
		if on != "c1" || req.User != labsv1.ActionAsAdmin {
			t.Errorf("command ran on %s as %s; want c1 as admin", on, req.User)
		}
		return drivers.ExecResult{Stdout: "match\n"}, nil
	}}
	g := &Grader{Exec: f, Entry: "entry"}
	score, res := g.Grade(context.Background(), []labsv1.Check{c})
	if score != 100 || !res[0].Passed {
		t.Fatalf("score %d %+v", score, res)
	}
	got := strings.Join(main.Command, "\x1f")
	if !strings.Contains(got, "env\x1fGOT_PRESENT=1\x1fGOT=31000\n\x1f/bin/sh\x1f-c") {
		t.Errorf("command argv %q does not pass GOT in the environment", main.Command)
	}
	if strings.Contains(got, "GONE") {
		t.Errorf("a missing input file must leave its variables unset: %q", main.Command)
	}
}

// An input file that is too large or unreadable makes the check error out
// (never pass), and the command does not run.
func TestShellInputErrors(t *testing.T) {
	for name, reply := range map[string]drivers.ExecResult{
		"too large":  {Stdout: strings.Repeat("x", MaxInput+1)},
		"unreadable": {ExitCode: 1, Stderr: "Permission denied"},
	} {
		ran := false
		f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
			if strings.Contains(strings.Join(req.Command, " "), "/home/learner/a") {
				return reply, nil
			}
			ran = true
			return drivers.ExecResult{Stdout: "ok"}, nil
		}}
		g := &Grader{Exec: f, Entry: "ws"}
		_, res := g.Grade(context.Background(), []labsv1.Check{{ID: "x", Type: "shell", Command: "echo ok",
			Inputs: []labsv1.CheckInput{{Name: "A", File: "/home/learner/a"}}}})
		if res[0].Passed || res[0].Message != MsgError || ran {
			t.Errorf("%s: %+v ran=%v; want an error and no command run", name, res[0], ran)
		}
	}
}

// as: learner runs the shell check as the learner; the default is admin.
func TestShellAs(t *testing.T) {
	var users []labsv1.ActionUser
	f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		users = append(users, req.User)
		return drivers.ExecResult{Stdout: "ok"}, nil
	}}
	g := &Grader{Exec: f, Entry: "ws"}
	g.Grade(context.Background(), []labsv1.Check{{ID: "a", Type: "shell", Command: "true"}, {ID: "l", Type: "shell", Command: "true", As: labsv1.ActionAsLearner}})
	if len(users) != 2 || users[0] != labsv1.ActionAsAdmin || users[1] != labsv1.ActionAsLearner {
		t.Errorf("users %v; want [admin learner]", users)
	}
}

// Input reads and the command share the check's one timeout: a check with
// n inputs no longer runs for (n+1) x timeoutSec.
func TestShellInputsShareTheTimeout(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	var timeouts []time.Duration
	f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		timeouts = append(timeouts, req.Timeout-transportSlack)
		now = now.Add(4 * time.Second) // every exec takes 4 s
		return drivers.ExecResult{Stdout: "ok"}, nil
	}}
	g := &Grader{Exec: f, Entry: "ws", Now: func() time.Time { return now }}
	in := []labsv1.CheckInput{{Name: "A", File: "/home/learner/a"}, {Name: "B", File: "/home/learner/b"}}
	_, res := g.Grade(context.Background(), []labsv1.Check{{ID: "x", Type: "shell", Command: "echo ok", TimeoutSec: 10, Inputs: in,
		Expect: &labsv1.Expectation{Match: "exact", Value: "ok"}}})
	if !res[0].Passed || len(timeouts) != 3 || timeouts[0] != 10*time.Second || timeouts[1] != 6*time.Second || timeouts[2] != 2*time.Second {
		t.Fatalf("timeouts %v result %+v; want 10s, 6s, 2s and a pass", timeouts, res[0])
	}
	// Used up by the reads: the check times out and the command never runs.
	timeouts = nil
	_, res = g.Grade(context.Background(), []labsv1.Check{{ID: "x", Type: "shell", Command: "echo ok", TimeoutSec: 8, Inputs: in}})
	if res[0].Passed || res[0].Message != MsgTimeout || len(timeouts) != 2 {
		t.Fatalf("timeouts %v result %+v; want a timeout after the two reads", timeouts, res[0])
	}
}

// Inputs together are capped, and so is the quoted command that carries
// them: on a VM host the whole argv is one shell-quoted ssh argument, and
// Linux refuses an argument over 128 KiB (E2BIG).
func TestShellInputsSizeForVMHosts(t *testing.T) {
	for name, content := range map[string]string{
		"two 64 KiB files":      strings.Repeat("x", MaxInput),
		"quotes grow 4x on ssh": strings.Repeat("'", 32<<10),
	} {
		ran := false
		f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
			if strings.Contains(strings.Join(req.Command, " "), "/home/learner/") {
				return drivers.ExecResult{Stdout: content}, nil
			}
			ran = true
			return drivers.ExecResult{Stdout: "ok"}, nil
		}}
		g := &Grader{Exec: f, Entry: "ws"}
		in := []labsv1.CheckInput{{Name: "A", File: "/home/learner/a"}, {Name: "B", File: "/home/learner/b"}}
		_, res := g.Grade(context.Background(), []labsv1.Check{{ID: "x", Type: "shell", On: "vm1", Command: "echo ok", Inputs: in}})
		if res[0].Passed || res[0].Message != MsgError || ran {
			t.Errorf("%s: %+v ran=%v; want an error before the command runs", name, res[0], ran)
		}
	}
	// Within the caps the quoted ssh argument stays under MAX_ARG_STRLEN.
	var argv []string
	f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		if strings.Contains(strings.Join(req.Command, " "), "/home/learner/") {
			return drivers.ExecResult{Stdout: strings.Repeat("'", 5<<10) + strings.Repeat("x", 55<<10)}, nil
		}
		argv = req.Command
		return drivers.ExecResult{Stdout: "ok"}, nil
	}}
	g := &Grader{Exec: f, Entry: "ws"}
	g.Grade(context.Background(), []labsv1.Check{{ID: "x", Type: "shell", On: "vm1", Command: "echo ok", Inputs: []labsv1.CheckInput{{Name: "A", File: "/home/learner/a"}}}})
	quoted := make([]string, len(argv))
	for i, a := range argv {
		quoted[i] = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
	}
	if n := len(strings.Join(quoted, " ")); argv == nil || n > 128<<10 || n != quotedLen(argv)-1 {
		t.Errorf("quoted ssh argument %d bytes (quotedLen %d); want it to run and stay under 128 KiB", n, quotedLen(argv))
	}
}

// The shared input deadline starts from the bounded check timeout (#383): a
// timeoutSec past the 300 s cap gives the reads and the command 300 s in all,
// never 300 s each.
func TestShellInputsDeadlineIsBounded(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	var timeouts []time.Duration
	f := &fakeExec{reply: func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		timeouts = append(timeouts, req.Timeout-transportSlack)
		now = now.Add(100 * time.Second)
		return drivers.ExecResult{Stdout: "ok"}, nil
	}}
	g := &Grader{Exec: f, Entry: "ws", Now: func() time.Time { return now }}
	in := []labsv1.CheckInput{{Name: "A", File: "/home/learner/a"}, {Name: "B", File: "/home/learner/b"}}
	_, res := g.Grade(context.Background(), []labsv1.Check{{ID: "x", Type: "shell", Command: "echo ok", TimeoutSec: 900, Inputs: in}})
	if len(timeouts) != 3 || timeouts[0] != MaxTimeout || timeouts[1] != MaxTimeout-100*time.Second || timeouts[2] != MaxTimeout-200*time.Second || !res[0].Passed {
		t.Fatalf("timeouts %v result %+v; want 300s, 200s, 100s", timeouts, res[0])
	}
}
