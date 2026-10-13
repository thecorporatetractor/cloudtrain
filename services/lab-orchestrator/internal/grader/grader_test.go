package grader

import (
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
	if byID["dev"].Message != MsgUnsupported {
		t.Errorf("dev message = %q", byID["dev"].Message)
	}
	// Routing: shell defaults to the entry node, k8s-query to the cluster,
	// k8s-context runs as the learner.
	joined := strings.Join(f.calls, "\n")
	for _, w := range []string{"ws|admin|timeout -k 2 5 /bin/sh -c echo hi", "c1|admin|timeout -k 2 5 kubectl get node n1 -o jsonpath={.spec.unschedulable}",
		"ws|learner|timeout -k 2 5 kubectl config current-context", "c1|admin|timeout -k 2 5 kubectl auth can-i delete pods -n ns --as system:serviceaccount:ns:sa"} {
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
