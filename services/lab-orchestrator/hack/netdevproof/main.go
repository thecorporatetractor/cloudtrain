// Command netdevproof drives a running network LabSession through the
// orchestrator's own drivers (no kubectl exec): it applies solution steps
// or a misconception mutation, runs the lab's device-cmd / shell /
// reachability checks the way a grader would, and captures on a link end.
// It is a development aid until the grader and `labctl verify` land.
//
//	go run ./hack/netdevproof -n NS -session NAME solution|checks|mutation ID|capture node:iface [filter]
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/controller"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func main() {
	ns := flag.String("n", "", "session namespace")
	name := flag.String("session", "", "LabSession name")
	registry := flag.String("image-registry", "cloudtrain", "same as the manager's --image-registry")
	flag.Parse()
	if *ns == "" || *name == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: netdevproof -n NS -session NAME solution|checks|mutation ID|capture node:iface [filter]")
		os.Exit(2)
	}
	if err := run(*ns, *name, *registry, flag.Args()); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(ns, name, registry string, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = labsv1.AddToScheme(scheme)
	cfg := ctrl.GetConfigOrDie()
	c, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		return err
	}
	ex, err := drivers.NewRESTPodExecutor(cfg)
	if err != nil {
		return err
	}
	container := &drivers.ContainerDriver{Client: c, Scheme: scheme, ImageRegistry: registry, Executor: ex}
	ln := &drivers.LinkNetwork{Manager: &network.Manager{Client: c}, ToolsImage: container.ImageFor("nettools:1")}
	container.Network = ln
	reg, err := drivers.NewDefaultRegistry(container)
	if err != nil {
		return err
	}
	reg.Replace(drivers.NewNetdev(container))

	s := &labsv1.LabSession{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, s); err != nil {
		return err
	}
	lt := &labsv1.LabTemplate{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: s.Spec.TemplateRef.Name}, lt); err != nil {
		return err
	}
	spec, _, err := compile.Resolve(&lt.Spec, s.Spec.Seed, compile.ResolveOptions{})
	if err != nil {
		return err
	}
	exec := func(on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
		for _, n := range spec.Topology.Nodes {
			if n.Name == on {
				d, err := reg.Get(n.Driver)
				if err != nil {
					return drivers.ExecResult{}, err
				}
				return d.Exec(ctx, drivers.NodeRef{Session: s, Template: spec, Node: n}, req)
			}
		}
		return drivers.ExecResult{}, fmt.Errorf("unknown node %q", on)
	}
	actions := func(label string, as []labsv1.Action) error {
		for i, a := range as {
			res, err := exec(a.On, controller.ActionRequest(a))
			if err != nil {
				return fmt.Errorf("%s step %d: %w", label, i, err)
			}
			fmt.Printf("%s step %d on %s: exit %d\n", label, i, a.On, res.ExitCode)
			if res.ExitCode != 0 {
				return fmt.Errorf("%s step %d failed: %s %s", label, i, res.Stdout, res.Stderr)
			}
		}
		return nil
	}

	switch args[0] {
	case "solution":
		return actions("solution", spec.Solution.Steps)
	case "mutation":
		if len(args) < 2 {
			return fmt.Errorf("mutation needs an id")
		}
		for _, m := range spec.Misconceptions {
			if m.ID == args[1] && m.Mutation != nil {
				return actions("mutation "+m.ID, []labsv1.Action{*m.Mutation})
			}
		}
		return fmt.Errorf("no mutation %q", args[1])
	case "checks":
		failed := 0
		for _, ck := range spec.Checks {
			ok, out, err := runCheck(exec, ck)
			if err != nil {
				return fmt.Errorf("check %s: %w", ck.ID, err)
			}
			mark := "PASS"
			if !ok {
				mark, failed = "FAIL", failed+1
			}
			fmt.Printf("--- check %-14s %s (%s on %s: %q)\n%s\n", ck.ID, mark, ck.Type, ck.On, ck.Command+ck.Target, indent(out))
		}
		fmt.Printf("checks: %d/%d passed\n", len(spec.Checks)-failed, len(spec.Checks))
		return nil
	case "capture":
		if len(args) < 2 {
			return fmt.Errorf("capture needs node:iface")
		}
		node, iface, _ := strings.Cut(args[1], ":")
		filter := ""
		if len(args) > 2 {
			filter = args[2]
		}
		cctx, ccancel := context.WithTimeout(ctx, 60*time.Second)
		defer ccancel()
		return ln.Capture(cctx, ex, drivers.SessionRef{Session: s, Template: spec}, node, iface,
			network.CaptureOptions{Filter: filter, Count: 4}, os.Stdout, os.Stderr)
	}
	return fmt.Errorf("unknown command %q", args[0])
}

type execFunc func(on string, req drivers.ExecRequest) (drivers.ExecResult, error)

// runCheck evaluates the check types a network lab uses.
func runCheck(exec execFunc, ck labsv1.Check) (bool, string, error) {
	var req drivers.ExecRequest
	switch ck.Type {
	case "device-cmd":
		req = drivers.ExecRequest{Kind: drivers.ExecDeviceCommand, Command: []string{ck.Command}}
	case "shell":
		req = drivers.ExecRequest{Kind: drivers.ExecShell, Command: []string{"/bin/sh", "-c", ck.Command}}
	case "reachability":
		req = drivers.ExecRequest{Kind: drivers.ExecShell, Command: []string{"ping", "-c", "3", "-W", "2", ck.Target}}
	default:
		return false, "", fmt.Errorf("check type %s not handled here", ck.Type)
	}
	req.Timeout = time.Minute
	res, err := exec(ck.On, req)
	if err != nil {
		return false, "", err
	}
	out := res.Stdout + res.Stderr
	if ck.Expect == nil {
		return res.ExitCode == 0, out, nil
	}
	v := ck.Expect.Value
	switch ck.Expect.Match {
	case labsv1.MatchType("contains"):
		return strings.Contains(out, v), out, nil
	case labsv1.MatchType("not_contains"):
		return !strings.Contains(out, v), out, nil
	case labsv1.MatchType("exact"):
		return strings.TrimSpace(out) == v, out, nil
	case labsv1.MatchType("regex"):
		ok, err := regexp.MatchString(v, out)
		return ok, out, err
	}
	return false, out, fmt.Errorf("match %s not handled", ck.Expect.Match)
}

func indent(s string) string {
	s = strings.TrimRight(s, "\n")
	return "    " + strings.ReplaceAll(s, "\n", "\n    ")
}
