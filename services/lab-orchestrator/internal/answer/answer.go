// Package answer grades answers to answer checks (CTF-style questions).
//
// The gateway grades learner submissions with a TypeScript port of the same
// rules (services/gateway/src/answers/match.ts); both run the shared vectors
// in packages/lab-schema/testdata/answer-matchers.json, so a lab verified
// with labctl grades the same way for learners.
package answer

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// MaxLength is the longest answer the platform accepts (bytes).
const MaxLength = 512

// MaxComputed caps a computed expected answer (bytes).
const MaxComputed = 4096

// ErrNotComputed: the session has no computed value for the check yet.
var ErrNotComputed = errors.New("the expected answer has not been computed yet")

// isSpace is the whitespace set both implementations share: ASCII
// whitespace and the no-break space (not Go's or JavaScript's full sets,
// which differ).
func isSpace(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\v', '\f', '\r', ' ':
		return true
	}
	return false
}

// Normalize applies the whitespace rule, then lower-cases unless caseSensitive.
func Normalize(s string, ws labsv1.AnswerWhitespace, caseSensitive bool) string {
	switch ws {
	case labsv1.WhitespaceNone:
	case labsv1.WhitespaceTrim:
		s = strings.TrimFunc(s, isSpace)
	case labsv1.WhitespaceRemove:
		s = strings.Map(func(r rune) rune {
			if isSpace(r) {
				return -1
			}
			return r
		}, s)
	default: // collapse
		s = strings.Join(strings.FieldsFunc(s, isSpace), " ")
	}
	if !caseSensitive {
		s = strings.ToLower(s)
	}
	return s
}

var numberRe = regexp.MustCompile(`^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$`)

// ParseNumber parses a plain decimal number (optional sign, fraction and
// exponent; surrounding whitespace ignored). Hex, infinities, NaN and
// thousands separators are refused.
func ParseNumber(s string) (float64, bool) {
	s = strings.TrimFunc(s, isSpace)
	if !numberRe.MatchString(s) {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return 0, false
	}
	return f, true
}

// Expected returns the accepted values of a resolved answer spec ({{params}}
// already substituted): the literal value(s), or the computed output (each
// non-empty line for any-of).
func Expected(a *labsv1.AnswerSpec, computed string, hasComputed bool) ([]string, error) {
	switch {
	case a.Compute != nil:
		if !hasComputed {
			return nil, ErrNotComputed
		}
		if a.Match != labsv1.AnswerAnyOf {
			return []string{computed}, nil
		}
		var out []string
		for _, l := range strings.Split(computed, "\n") {
			l = strings.TrimSuffix(l, "\r")
			if strings.TrimFunc(l, isSpace) != "" {
				out = append(out, l)
			}
		}
		if len(out) == 0 {
			return nil, fmt.Errorf("the computed answer is empty")
		}
		return out, nil
	case a.Value != nil:
		return []string{*a.Value}, nil
	case len(a.Values) > 0:
		return a.Values, nil
	}
	return nil, fmt.Errorf("answer has no expected value")
}

// Match reports whether submitted matches one of expected under a's rules.
// An error means the lab itself is broken (e.g. an expected number that does
// not parse), never that the answer is wrong.
func Match(a *labsv1.AnswerSpec, expected []string, submitted string) (bool, error) {
	if len(expected) == 0 {
		return false, fmt.Errorf("no expected value")
	}
	got := Normalize(submitted, a.Whitespace, a.CaseSensitive)
	switch a.Match {
	case labsv1.AnswerExact, labsv1.AnswerAnyOf:
		for _, e := range expected {
			if Normalize(e, a.Whitespace, a.CaseSensitive) == got {
				return true, nil
			}
		}
		return false, nil
	case labsv1.AnswerNumber:
		want, ok := ParseNumber(expected[0])
		if !ok {
			return false, fmt.Errorf("expected value %q is not a number", expected[0])
		}
		tol := 0.0
		if a.Tolerance != "" {
			t, err := strconv.ParseFloat(a.Tolerance, 64)
			if err != nil || t < 0 {
				return false, fmt.Errorf("invalid tolerance %q", a.Tolerance)
			}
			tol = t
		}
		have, ok := ParseNumber(submitted)
		if !ok {
			return false, nil
		}
		return math.Abs(have-want) <= tol+1e-9*math.Max(1, math.Abs(want)), nil
	case labsv1.AnswerRegex:
		flags := ""
		if !a.CaseSensitive {
			flags = "(?i)"
		}
		re, err := regexp.Compile(flags + "^(?:" + expected[0] + ")$")
		if err != nil {
			return false, fmt.Errorf("invalid regex: %v", err)
		}
		return re.MatchString(got), nil
	}
	return false, fmt.Errorf("unknown match %q", a.Match)
}

// Award is the points a solved question earns: points minus the penalty for
// every wrong answer and the cost of every revealed hint, never below 0.
func Award(points, penalty, wrong, hintCost int) int {
	v := points - penalty*wrong - hintCost
	if v < 0 {
		return 0
	}
	return v
}
