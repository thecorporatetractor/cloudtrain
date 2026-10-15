// Package grader runs a lab's checks against a live session and scores them.
//
// Checks run out of band with admin credentials on check.on (or the entry
// node, or query.cluster for k8s-* checks) through the node drivers. The
// result message is learner-safe: it never contains the expected value.
package grader

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

const (
	// DefaultTimeout applies when a check has no timeoutSec.
	DefaultTimeout = 5 * time.Second
	// DefaultShellTimeout applies to shell checks without timeoutSec: they
	// usually make several calls (kubectl, ssh) and 5s was too short under
	// load. Matches the compiler's default for shell checks.
	DefaultShellTimeout = 30 * time.Second
	// MaxTimeout caps a single check.
	MaxTimeout = 5 * time.Minute
	// transportSlack is added to the exec deadline on top of the in-target
	// `timeout`, for the exec / ssh round trip.
	transportSlack = 20 * time.Second
	// MaxOutput is the stored output size.
	MaxOutput = 2048
)

// Learner-safe messages.
const (
	MsgPassed      = "passed"
	MsgFailed      = "not satisfied yet"
	MsgTimeout     = "the check timed out"
	MsgError       = "the check could not run"
	MsgUnsupported = "this check type is not supported by the grader"
)

// Executor runs a request on a topology node ("node" or "node/member").
type Executor interface {
	Exec(ctx context.Context, on string, req drivers.ExecRequest) (drivers.ExecResult, error)
}

// Grader grades checks of one session.
type Grader struct {
	Exec Executor
	// Entry is the topology's entry node (default target of checks).
	Entry string
	// Now is injectable for tests.
	Now func() time.Time
}

func (g *Grader) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

// Grade runs every check once, in order, and returns the weighted score
// (0-100) and per-check results.
func (g *Grader) Grade(ctx context.Context, checks []labsv1.Check) (int32, []labsv1.CheckResult) {
	results := make([]labsv1.CheckResult, 0, len(checks))
	var total, got float64
	for _, c := range checks {
		start := g.now()
		r := g.run(ctx, c)
		r.DurationMs = g.now().Sub(start).Milliseconds()
		w := weight(c.Weight)
		total += w
		if r.Passed {
			got += w
		}
		results = append(results, r)
	}
	return Score(got, total), results
}

// Score is the rounded weighted percentage.
func Score(got, total float64) int32 {
	if total <= 0 {
		return 0
	}
	return int32(math.Round(100 * got / total))
}

func weight(s string) float64 {
	if s == "" {
		return 1
	}
	w, err := strconv.ParseFloat(s, 64)
	if err != nil || w < 0 {
		return 1
	}
	return w
}

// outcome is what a check type's probe observed.
type outcome struct {
	output string // value compared with expect
	raw    string // stored output
	ok     bool   // default pass condition when there is no expect
	// skipExpect: the observation failed (e.g. file missing): fail regardless.
	failed bool
}

func timeoutOf(c labsv1.Check) time.Duration {
	t := DefaultTimeout
	if c.Type == "shell" {
		t = DefaultShellTimeout
	}
	if c.TimeoutSec > 0 {
		t = time.Duration(c.TimeoutSec) * time.Second
	}
	if t > MaxTimeout {
		t = MaxTimeout
	}
	return t
}

// wrap runs argv under coreutils timeout in the target.
func wrap(t time.Duration, argv ...string) []string {
	secs := strconv.Itoa(int(math.Ceil(t.Seconds())))
	return append([]string{"timeout", "-k", "2", secs}, argv...)
}

func sh(t time.Duration, script string) []string { return wrap(t, "/bin/sh", "-c", script) }

func (g *Grader) run(ctx context.Context, c labsv1.Check) labsv1.CheckResult {
	r := labsv1.CheckResult{ID: c.ID, Weight: c.Weight, Skills: c.Skills}
	if r.Weight == "" {
		r.Weight = "1"
	}
	o, err := g.probe(ctx, c)
	r.Output = truncate(o.raw)
	switch {
	case errors.Is(err, errTimeout):
		r.Message = MsgTimeout
		return r
	case errors.Is(err, drivers.ErrUnsupported):
		r.Message = MsgUnsupported
		if r.Output == "" {
			r.Output = truncate(err.Error())
		}
		return r
	case err != nil:
		r.Message = MsgError
		if r.Output == "" {
			r.Output = truncate(err.Error())
		}
		return r
	}
	pass := o.ok
	if c.Expect != nil && !o.failed {
		m, merr := Match(c.Expect, o.output)
		if merr != nil {
			r.Message = MsgError
			r.Output = truncate(merr.Error())
			return r
		}
		pass = m
	} else if o.failed {
		pass = false
	}
	r.Passed = pass
	if pass {
		r.Message = MsgPassed
	} else {
		r.Message = MsgFailed
	}
	return r
}

var errTimeout = errors.New("timeout")

func (g *Grader) target(on string) string {
	if on != "" {
		return on
	}
	return g.Entry
}

// ExecDeviceCommand is the exec kind of device-cmd checks (the netdev
// driver's drivers.ExecDeviceCommand, "device-cmd").
const ExecDeviceCommand drivers.ExecKind = "device-cmd"

// exec runs argv on a node with the check's deadline. Exit code 124/137 of
// coreutils timeout is reported as errTimeout.
func (g *Grader) exec(ctx context.Context, on string, user labsv1.ActionUser, t time.Duration, argv []string) (drivers.ExecResult, error) {
	return g.run1(ctx, on, drivers.ExecShell, user, t, argv)
}

// execKind runs a non-shell request (argv is passed as is, no timeout wrapper).
func (g *Grader) execKind(ctx context.Context, on string, kind drivers.ExecKind, t time.Duration, argv []string) (drivers.ExecResult, error) {
	return g.run1(ctx, on, kind, labsv1.ActionAsAdmin, t, argv)
}

func (g *Grader) run1(ctx context.Context, on string, kind drivers.ExecKind, user labsv1.ActionUser, t time.Duration, argv []string) (drivers.ExecResult, error) {
	if on == "" {
		return drivers.ExecResult{}, fmt.Errorf("check has no target node: %w", drivers.ErrUnsupported)
	}
	if user == "" {
		user = labsv1.ActionAsAdmin
	}
	_, member, _ := strings.Cut(on, "/")
	cctx, cancel := context.WithTimeout(ctx, t+transportSlack)
	defer cancel()
	res, err := g.Exec.Exec(cctx, on, drivers.ExecRequest{Kind: kind, Member: member, User: user, Command: argv, Timeout: t + transportSlack})
	if err != nil {
		if cctx.Err() != nil && ctx.Err() == nil {
			return res, errTimeout
		}
		return res, err
	}
	if res.ExitCode == 124 || res.ExitCode == 137 {
		return res, errTimeout
	}
	return res, nil
}

func raw(res drivers.ExecResult) string {
	out := res.Stdout
	if s := strings.TrimSpace(res.Stderr); s != "" {
		if out != "" && !strings.HasSuffix(out, "\n") {
			out += "\n"
		}
		out += "[stderr] " + s
	}
	return out
}

func (g *Grader) probe(ctx context.Context, c labsv1.Check) (outcome, error) {
	t := timeoutOf(c)
	q := c.Query
	if q == nil {
		q = &labsv1.CheckQuery{}
	}
	switch c.Type {
	case "shell":
		if c.Command == "" {
			return outcome{}, fmt.Errorf("shell check has no command")
		}
		res, err := g.exec(ctx, g.target(c.On), labsv1.ActionAsAdmin, t, sh(t, c.Command))
		return outcome{output: res.Stdout, raw: raw(res), ok: res.ExitCode == 0}, err

	case "k8s-query":
		on := q.Cluster
		if on == "" {
			on = c.On
		}
		if q.Resource == "" {
			return outcome{}, fmt.Errorf("k8s-query check has no resource")
		}
		argv := []string{"kubectl", "get", q.Resource}
		if q.Name != "" {
			argv = append(argv, q.Name)
		}
		if q.Namespace != "" {
			argv = append(argv, "-n", q.Namespace)
		}
		if q.JSONPath != "" {
			argv = append(argv, "-o", "jsonpath="+q.JSONPath)
		} else {
			argv = append(argv, "-o", "name")
		}
		res, err := g.exec(ctx, on, labsv1.ActionAsAdmin, t, wrap(t, argv...))
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		if res.ExitCode != 0 {
			if isNotFound(res.Stderr) {
				// A missing object reads as empty output.
				return outcome{output: "", raw: raw(res), ok: false}, nil
			}
			return outcome{raw: raw(res)}, fmt.Errorf("kubectl get exited %d", res.ExitCode)
		}
		return outcome{output: res.Stdout, raw: raw(res), ok: strings.TrimSpace(res.Stdout) != ""}, nil

	case "k8s-can-i":
		on := q.Cluster
		if on == "" {
			on = c.On
		}
		if q.Verb == "" || q.Resource == "" {
			return outcome{}, fmt.Errorf("k8s-can-i check needs verb and resource")
		}
		argv := []string{"kubectl", "auth", "can-i", q.Verb, q.Resource}
		if q.Name != "" {
			argv[len(argv)-1] = q.Resource + "/" + q.Name
		}
		if q.Namespace != "" {
			argv = append(argv, "-n", q.Namespace)
		}
		if q.As != "" {
			argv = append(argv, "--as", q.As)
		}
		res, err := g.exec(ctx, on, labsv1.ActionAsAdmin, t, wrap(t, argv...))
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		ans := strings.TrimSpace(res.Stdout)
		if ans != "yes" && ans != "no" {
			return outcome{raw: raw(res)}, fmt.Errorf("kubectl auth can-i exited %d", res.ExitCode)
		}
		return outcome{output: ans, raw: raw(res), ok: ans == "yes"}, nil

	case "k8s-context":
		res, err := g.exec(ctx, g.target(c.On), labsv1.ActionAsLearner, t, wrap(t, "kubectl", "config", "current-context"))
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		cur := ""
		if res.ExitCode == 0 {
			cur = strings.TrimSpace(res.Stdout)
		}
		return outcome{output: cur, raw: raw(res), ok: cur != ""}, nil

	case "file":
		if c.Target == "" {
			return outcome{}, fmt.Errorf("file check has no target")
		}
		res, err := g.exec(ctx, g.target(c.On), labsv1.ActionAsAdmin, t, wrap(t, "/bin/sh", "-c", `test -f "$1" || exit 3; cat -- "$1"`, "sh", c.Target))
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		if res.ExitCode == 3 {
			return outcome{raw: "file not found", failed: true}, nil
		}
		return outcome{output: res.Stdout, raw: raw(res), ok: res.ExitCode == 0}, nil

	case "service-state":
		if c.Target == "" {
			return outcome{}, fmt.Errorf("service-state check has no target")
		}
		res, err := g.exec(ctx, g.target(c.On), labsv1.ActionAsAdmin, t, wrap(t, "systemctl", "is-active", c.Target))
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		st := strings.TrimSpace(res.Stdout)
		return outcome{output: st, raw: raw(res), ok: st == "active"}, nil

	case "reachability":
		if c.Target == "" {
			return outcome{}, fmt.Errorf("reachability check has no target")
		}
		var argv []string
		if c.Port != nil {
			argv = wrap(t, "bash", "-c", `exec 3<>"/dev/tcp/$1/$2" && echo reachable`, "bash", c.Target, strconv.Itoa(int(*c.Port)))
		} else {
			argv = wrap(t, "/bin/sh", "-c", `ping -c 1 -W 2 "$1" >/dev/null 2>&1 && echo reachable`, "sh", c.Target)
		}
		res, err := g.exec(ctx, g.target(c.On), labsv1.ActionAsAdmin, t, argv)
		if errors.Is(err, errTimeout) {
			return outcome{output: "unreachable", raw: "timed out"}, nil
		}
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		st := "unreachable"
		if strings.TrimSpace(res.Stdout) == "reachable" {
			st = "reachable"
		}
		return outcome{output: st, raw: raw(res), ok: st == "reachable"}, nil

	case "http":
		url := c.Target
		if url == "" {
			return outcome{}, fmt.Errorf("http check has no target")
		}
		if !strings.Contains(url, "://") {
			host := url
			if c.Port != nil {
				host += ":" + strconv.Itoa(int(*c.Port))
			}
			url = "http://" + host + "/"
		}
		secs := strconv.Itoa(int(math.Ceil(t.Seconds())))
		res, err := g.exec(ctx, g.target(c.On), labsv1.ActionAsAdmin, t, wrap(t, "curl", "-sS", "-m", secs, "-w", "\n%{http_code}", url))
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		body, code := res.Stdout, ""
		if i := strings.LastIndexByte(body, '\n'); i >= 0 {
			body, code = body[:i], strings.TrimSpace(body[i+1:])
		}
		ok := res.ExitCode == 0 && len(code) == 3 && (code[0] == '2' || code[0] == '3')
		return outcome{output: body, raw: code + "\n" + body, ok: ok}, nil

	case "device-cmd":
		// Runs the device's own CLI command through the node's driver (netdev).
		if c.Command == "" {
			return outcome{}, fmt.Errorf("device-cmd check has no command")
		}
		res, err := g.execKind(ctx, g.target(c.On), ExecDeviceCommand, t, []string{c.Command})
		if err != nil {
			return outcome{raw: raw(res)}, err
		}
		return outcome{output: res.Stdout, raw: raw(res), ok: res.ExitCode == 0}, nil
	}
	return outcome{}, fmt.Errorf("check type %q: %w", c.Type, drivers.ErrUnsupported)
}

func isNotFound(stderr string) bool {
	return strings.Contains(stderr, "NotFound") || strings.Contains(stderr, "not found")
}

// Normalize is the output a check compares: the raw output with at most one
// trailing newline ("\n" or "\r\n") stripped. Nothing else is trimmed, so
// "3" and "3 " differ.
func Normalize(output string) string {
	if strings.HasSuffix(output, "\r\n") {
		return output[:len(output)-2]
	}
	return strings.TrimSuffix(output, "\n")
}

// Match compares the normalized output with an expectation's value (used
// verbatim). Regular expressions use Go RE2 syntax and match anywhere unless
// anchored.
func Match(e *labsv1.Expectation, output string) (bool, error) {
	out, want := Normalize(output), e.Value
	switch e.Match {
	case "exact", "":
		return out == want, nil
	case "not_exact":
		return out != want, nil
	case "contains":
		return strings.Contains(out, want), nil
	case "not_contains":
		return !strings.Contains(out, want), nil
	case "regex":
		re, err := regexp.Compile(e.Value)
		if err != nil {
			return false, fmt.Errorf("invalid regex: %v", err)
		}
		return re.MatchString(out), nil
	}
	return false, fmt.Errorf("unknown match %q", e.Match)
}

func truncate(s string) string {
	if len(s) <= MaxOutput {
		return s
	}
	cut := MaxOutput - len("…[truncated]")
	for cut > 0 && !utf8Start(s[cut]) {
		cut--
	}
	return s[:cut] + "…[truncated]"
}

func utf8Start(b byte) bool { return b&0xC0 != 0x80 }
