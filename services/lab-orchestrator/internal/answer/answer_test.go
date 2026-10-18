package answer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

type vector struct {
	Name   string `json:"name"`
	Answer struct {
		Match         string   `json:"match"`
		CaseSensitive bool     `json:"caseSensitive"`
		Whitespace    string   `json:"whitespace"`
		Tolerance     *float64 `json:"tolerance"`
	} `json:"answer"`
	Expected  []string `json:"expected"`
	Submitted string   `json:"submitted"`
	Accepted  bool     `json:"accepted"`
	Error     bool     `json:"error"`
}

// TestSharedVectors runs packages/lab-schema/testdata/answer-matchers.json,
// which the gateway's TypeScript matcher runs too.
func TestSharedVectors(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "packages", "lab-schema", "testdata", "answer-matchers.json")
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skip("not in the monorepo")
	}
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Vectors []vector `json:"vectors"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Vectors) < 20 {
		t.Fatalf("only %d vectors", len(doc.Vectors))
	}
	for _, v := range doc.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			a := &labsv1.AnswerSpec{Match: labsv1.AnswerMatch(v.Answer.Match), CaseSensitive: v.Answer.CaseSensitive, Whitespace: labsv1.AnswerWhitespace(v.Answer.Whitespace)}
			if a.Whitespace == "" {
				a.Whitespace = labsv1.WhitespaceCollapse
			}
			if v.Answer.Tolerance != nil {
				a.Tolerance = strconv.FormatFloat(*v.Answer.Tolerance, 'f', -1, 64)
			}
			got, err := Match(a, v.Expected, v.Submitted)
			if v.Error {
				if err == nil {
					t.Fatalf("want an error, got accepted=%v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != v.Accepted {
				t.Fatalf("accepted = %v, want %v", got, v.Accepted)
			}
		})
	}
}

func TestExpected(t *testing.T) {
	val := "x"
	cases := []struct {
		name     string
		a        labsv1.AnswerSpec
		computed string
		has      bool
		want     []string
		err      bool
	}{
		{"value", labsv1.AnswerSpec{Match: AnswerExactT, Value: &val}, "", false, []string{"x"}, false},
		{"values", labsv1.AnswerSpec{Match: labsv1.AnswerAnyOf, Values: []string{"a", "b"}}, "", false, []string{"a", "b"}, false},
		{"computed", labsv1.AnswerSpec{Match: AnswerExactT, Compute: &labsv1.AnswerCompute{Command: "c"}}, "42", true, []string{"42"}, false},
		{"computed multi-line exact keeps lines", labsv1.AnswerSpec{Match: AnswerExactT, Compute: &labsv1.AnswerCompute{Command: "c"}}, "a\nb", true, []string{"a\nb"}, false},
		{"computed any-of splits lines", labsv1.AnswerSpec{Match: labsv1.AnswerAnyOf, Compute: &labsv1.AnswerCompute{Command: "c"}}, "a\r\n\n  \nb", true, []string{"a", "b"}, false},
		{"computed any-of empty", labsv1.AnswerSpec{Match: labsv1.AnswerAnyOf, Compute: &labsv1.AnswerCompute{Command: "c"}}, "\n \n", true, nil, true},
		{"not computed yet", labsv1.AnswerSpec{Match: AnswerExactT, Compute: &labsv1.AnswerCompute{Command: "c"}}, "", false, nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Expected(&c.a, c.computed, c.has)
			if (err != nil) != c.err {
				t.Fatalf("err = %v", err)
			}
			if len(got) != len(c.want) {
				t.Fatalf("got %q, want %q", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("got %q, want %q", got, c.want)
				}
			}
		})
	}
}

const AnswerExactT = labsv1.AnswerExact

func TestAward(t *testing.T) {
	for _, c := range []struct{ points, penalty, wrong, hints, want int }{
		{100, 0, 5, 0, 100},
		{100, 10, 2, 0, 80},
		{100, 10, 2, 25, 55},
		{100, 30, 4, 0, 0},
		{50, 0, 0, 80, 0},
	} {
		if got := Award(c.points, c.penalty, c.wrong, c.hints); got != c.want {
			t.Errorf("Award(%d,%d,%d,%d) = %d, want %d", c.points, c.penalty, c.wrong, c.hints, got, c.want)
		}
	}
}

func TestParseNumber(t *testing.T) {
	for in, ok := range map[string]bool{"1": true, "-1.5": true, "+2e3": true, ".5": true, "5.": true, "0x1p-2": false, "NaN": false, "1_000": false, "": false, " 7 ": true, "1e400": false} {
		if _, got := ParseNumber(in); got != ok {
			t.Errorf("ParseNumber(%q) ok = %v, want %v", in, got, ok)
		}
	}
}
