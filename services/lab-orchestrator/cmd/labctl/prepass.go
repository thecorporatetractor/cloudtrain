package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// prepass is what passes before the solution.
type prepass struct {
	// ids of the checks that pass.
	ids []string
	// share of the check weight they carry (k8s-context checks excluded).
	share float64
	// solved: every check except k8s-context ones passes.
	solved   bool
	warnings []string
}

// echoExpectRe matches a command's fallback "|| echo <value>".
var echoExpectRe = regexp.MustCompile(`\|\|\s*echo\s+(?:"([^"\n]*)"|'([^'\n]*)'|([^\s;|&)]+))\s*(?:$|[;)\n])`)

// failOpen reports whether a shell check prints its expected value when its
// command fails ("... || echo ok" with expect exact ok).
func failOpen(c labsv1.Check) bool {
	if c.Type != "shell" || c.Expect == nil || (c.Expect.Match != "exact" && c.Expect.Match != "") {
		return false
	}
	for _, m := range echoExpectRe.FindAllStringSubmatch(c.Command, -1) {
		if v := m[1] + m[2] + m[3]; v == c.Expect.Value {
			return true
		}
	}
	return false
}

// checkPrepass evaluates the grading before the solution. k8s-context checks
// grade the learner switching context (always unset at start), so they
// neither block "already solved" nor count in the share.
func checkPrepass(spec *labsv1.LabTemplateSpec, before *GradeReport) prepass {
	byID := map[string]labsv1.Check{}
	for _, c := range spec.Checks {
		byID[c.ID] = c
	}
	var p prepass
	var total, passed float64
	counted := 0
	for _, r := range before.Checks {
		c := byID[r.ID]
		if c.Type == "k8s-context" {
			continue
		}
		counted++
		w := parseWeight(r.Weight)
		total += w
		if !r.Passed {
			continue
		}
		passed += w
		p.ids = append(p.ids, r.ID)
		if failOpen(c) {
			p.warnings = append(p.warnings, fmt.Sprintf("check %s passes before the solution and prints its expected value when its command fails (|| echo %s): make it fail closed", r.ID, c.Expect.Value))
		}
	}
	if total > 0 {
		p.share = passed / total
	}
	p.solved = counted > 0 && len(p.ids) == counted
	if len(p.ids) > 0 && !p.solved {
		p.warnings = append(p.warnings, "passes before the solution: "+strings.Join(p.ids, ", "))
	}
	return p
}

func parseWeight(s string) float64 {
	if s == "" {
		return 1
	}
	w, err := strconv.ParseFloat(s, 64)
	if err != nil || w < 0 {
		return 1
	}
	return w
}

// regradeDiffs lists the checks whose result changed between two gradings
// of the same state.
func regradeDiffs(a, b *GradeReport) []string {
	first := map[string]bool{}
	for _, c := range a.Checks {
		first[c.ID] = c.Passed
	}
	var out []string
	for _, c := range b.Checks {
		if was, ok := first[c.ID]; ok && was != c.Passed {
			state := "passed then failed"
			if c.Passed {
				state = "failed then passed"
			}
			out = append(out, fmt.Sprintf("check %s %s on an immediate second grading (%s)", c.ID, state, c.Message))
		}
	}
	return out
}

// gradeDuration is the time the grader spent on the checks.
func gradeDuration(g *GradeReport) time.Duration {
	var ms int64
	for _, c := range g.Checks {
		ms += c.DurationMs
	}
	return time.Duration(ms) * time.Millisecond
}
