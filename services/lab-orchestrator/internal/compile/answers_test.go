package compile

import (
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

const answerLab = `
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: ctf-lab, title: CTF, domain: linux, difficulty: easy, estimatedMinutes: 15}
spec:
  description: Investigate /var/log/app.log on box.
  params:
    attacker: {type: choice, values: ["203.0.113.7", "198.51.100.23"], secret: true}
    salt: {type: int, min: 1, max: 9}
  topology: {nodes: [{name: box, driver: container, image: "deb-lab:24.04"}]}
  setup:
    - {on: box, run: "echo {{attacker}} {{salt}} > /var/log/app.log"}
  questionOrder: sequential
  checks:
    - id: q-ip
      description: Which IP address attacked the service?
      type: answer
      skills: [linux.shell]
      answer:
        match: exact
        value: "{{attacker}}"
        points: 50
        maxAttempts: 3
        penalty: 5
        placeholder: 192.0.2.1
        hints:
          - {body: Look at the log.}
          - {body: Use awk., cost: 20}
    - id: q-count
      description: How many lines does the log have?
      type: answer
      skills: [linux.shell]
      answer: {match: number, compute: {command: "wc -l < /var/log/app.log"}, tolerance: 0.5}
    - id: q-any
      description: Name a field of the log
      type: answer
      skills: [linux.shell]
      answer: {match: any-of, compute: {on: box, command: "tr ' ' '\\n' < /var/log/app.log", timeoutSec: 5}}
    - {id: report, description: Report written, type: shell, on: box, skills: [linux.shell], command: "test -f /tmp/report"}
  misconceptions:
    - id: wrong-ip
      description: Picks the first IP in the file.
      answers: {q-ip: "192.0.2.99", q-count: {command: "echo 0"}}
      expectFail: [q-ip, q-count]
    - id: no-report
      description: Forgets the report.
      mutation: {on: box, run: "true"}
      expectFail: [report]
  solution:
    steps: [{on: box, run: touch /tmp/report}]
    answers:
      q-ip: {command: "awk '{print $1}' /var/log/app.log"}
      q-count: {on: box, as: admin, command: "wc -l < /var/log/app.log", timeoutSec: 10}
      q-any: "{{salt}}"
`

func TestCompileAnswerLab(t *testing.T) {
	tpl, err := Compile([]byte(answerLab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	s := tpl.Spec
	if s.QuestionOrder != "sequential" {
		t.Errorf("questionOrder = %q", s.QuestionOrder)
	}
	if !s.Params["attacker"].Secret || s.Params["salt"].Secret {
		t.Errorf("secret flags: %+v", s.Params)
	}
	q := s.Checks[0]
	if q.Type != labsv1.CheckTypeAnswer || q.Answer == nil || q.TimeoutSec != 0 {
		t.Fatalf("q-ip = %+v", q)
	}
	a := q.Answer
	if a.Match != labsv1.AnswerExact || *a.Value != "{{attacker}}" || a.Points != 50 || a.MaxAttempts != 3 || a.Penalty != 5 || a.Whitespace != labsv1.WhitespaceCollapse || a.Placeholder != "192.0.2.1" {
		t.Errorf("q-ip answer = %+v", a)
	}
	if len(a.Hints) != 2 || a.Hints[0].Cost != DefaultAnswerHintCost || a.Hints[1].Cost != 20 {
		t.Errorf("hints = %+v", a.Hints)
	}
	c := s.Checks[1].Answer
	if c.Points != DefaultAnswerPoints || c.Tolerance != "0.5" || c.Compute == nil || c.Compute.TimeoutSec != DefaultComputeTimeoutSec || c.Compute.On != "" {
		t.Errorf("q-count answer = %+v / %+v", c, c.Compute)
	}
	if s.Checks[2].Answer.Compute.TimeoutSec != 5 {
		t.Errorf("q-any compute = %+v", s.Checks[2].Answer.Compute)
	}
	sa := s.Solution.Answers
	if sa["q-ip"].Command == "" || sa["q-ip"].As != labsv1.ActionAsLearner || sa["q-ip"].TimeoutSec != DefaultAnswerInputTimeoutSec {
		t.Errorf("solution q-ip = %+v", sa["q-ip"])
	}
	if sa["q-count"].As != labsv1.ActionAsAdmin || sa["q-count"].On != "box" || sa["q-count"].TimeoutSec != 10 {
		t.Errorf("solution q-count = %+v", sa["q-count"])
	}
	if sa["q-any"].Value == nil || *sa["q-any"].Value != "{{salt}}" {
		t.Errorf("solution q-any = %+v", sa["q-any"])
	}
	m := s.Misconceptions[0]
	if m.Mutation != nil || *m.Answers["q-ip"].Value != "192.0.2.99" || m.Answers["q-count"].Command != "echo 0" {
		t.Errorf("misconception = %+v", m)
	}

	// Params resolve into expected values and solution answers.
	res, vals, err := Resolve(&s, 3, ResolveOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if *res.Checks[0].Answer.Value != vals["attacker"] || *res.Solution.Answers["q-any"].Value != vals["salt"] {
		t.Errorf("resolved: %v / %v", *res.Checks[0].Answer.Value, vals)
	}
}

func TestPlainLabHasNoQuestionOrder(t *testing.T) {
	tpl, err := Compile([]byte(minimalLab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if tpl.Spec.QuestionOrder != "" || HasAnswerChecks(&tpl.Spec) {
		t.Errorf("questionOrder = %q", tpl.Spec.QuestionOrder)
	}
}

func TestAnswerLabOnlyQuestions(t *testing.T) {
	lab := `
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: only-q, title: Q, domain: linux, difficulty: easy, estimatedMinutes: 5}
spec:
  description: d
  topology: {nodes: [{name: box, driver: container, image: x}]}
  checks:
    - {id: q, description: "How many?", type: answer, skills: [s], answer: {match: number, compute: {command: "echo 3"}}}
  solution:
    answers: {q: {command: "echo 3"}}
`
	tpl, err := Compile([]byte(lab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(tpl.Spec.Solution.Steps) != 0 || tpl.Spec.QuestionOrder != "free" {
		t.Errorf("spec = %+v", tpl.Spec.Solution)
	}
}

func TestAnswerLabInvalid(t *testing.T) {
	tests := []struct {
		name     string
		old, new string
		want     []string
	}{
		{"static expected answer", `value: "{{attacker}}"`, `value: "203.0.113.7"`, []string{"/spec/checks/0/answer", "must come from the session"}},
		{"param not secret", `secret: true}`, `secret: false}`, []string{"gives the expected answer away", "secret: true"}},
		{"secret in description", "Investigate /var/log/app.log on box.", "Investigate {{attacker}}.", []string{"/spec/description", "secret param {{attacker}}"}},
		{"secret in question hint", "{body: Look at the log.}", "{body: \"It is {{attacker}}\"}", []string{"/spec/checks/0/answer/hints/0/body"}},
		{"secret in question", "Which IP address attacked the service?", "Was it {{attacker}}?", []string{"/spec/checks/0/description"}},
		{"answer missing", "      answer:\n        match: exact\n", "      x-answer:\n        match: exact\n", []string{"/spec/checks/0"}},
		{"answer on shell check", `command: "test -f /tmp/report"}`, `command: "test -f /tmp/report", answer: {match: exact, value: "{{attacker}}"}}`, []string{"/spec/checks/3"}},
		{"on given on answer check", "      type: answer\n      skills: [linux.shell]\n      answer:\n        match: exact", "      type: answer\n      on: box\n      skills: [linux.shell]\n      answer:\n        match: exact", []string{"/spec/checks/0"}},
		{"two sources", `{match: number, compute: {command: "wc -l < /var/log/app.log"}, tolerance: 0.5}`, `{match: number, value: "{{salt}}", compute: {command: "x"}}`, []string{"/spec/checks/1/answer"}},
		{"any-of with value", `{match: any-of, compute: {on: box, command: "tr ' ' '\\n' < /var/log/app.log", timeoutSec: 5}}`, `{match: any-of, value: "{{attacker}}"}`, []string{"any-of takes values"}},
		{"exact with values", `value: "{{attacker}}"`, `values: ["{{attacker}}"]`, []string{"exact takes value"}},
		{"tolerance on exact", "        penalty: 5\n", "        penalty: 5\n        tolerance: 1\n", []string{"tolerance only applies to match number"}},
		{"number value not numeric", `{match: number, compute: {command: "wc -l < /var/log/app.log"}, tolerance: 0.5}`, `{match: number, value: "x{{attacker}}"}`, []string{"is not a decimal number"}},
		{"bad regex", "match: exact\n        value: \"{{attacker}}\"", "match: regex\n        value: \"({{attacker}}\"", []string{"invalid regex"}},
		{"compute on unknown node", "compute: {on: box,", "compute: {on: ghost,", []string{"/spec/checks/2/answer/compute/on"}},
		{"solution misses an answer", "      q-any: \"{{salt}}\"\n", "", []string{"no answer for answer check \"q-any\""}},
		{"solution answers a shell check", "      q-any: \"{{salt}}\"\n", "      q-any: \"{{salt}}\"\n      report: \"x\"\n", []string{"/spec/solution/answers/report", "not an answer check"}},
		{"misconception answers and mutation", "      answers: {q-ip: \"192.0.2.99\", q-count: {command: \"echo 0\"}}\n", "      answers: {q-ip: \"192.0.2.99\", q-count: {command: \"echo 0\"}}\n      mutation: {on: box, run: \"true\"}\n", []string{"either mutation or answers"}},
		{"expectFail without an answer", "expectFail: [q-ip, q-count]", "expectFail: [q-ip, q-count, q-any]", []string{"gets no answer in this misconception"}},
		{"mutation aimed at a question", "expectFail: [report]", "expectFail: [report, q-ip]", []string{"cannot make answer check \"q-ip\" fail"}},
		{"expectFail without mutation or answers", "      answers: {q-ip: \"192.0.2.99\", q-count: {command: \"echo 0\"}}\n", "", []string{"/spec/misconceptions/0"}},
		{"end-state checks need steps", "    steps: [{on: box, run: touch /tmp/report}]\n", "", []string{"needs steps"}},
		{"bad question order", "questionOrder: sequential", "questionOrder: random", []string{"/spec/questionOrder"}},
		{"answer input with unknown key", `q-count: {on: box, as: admin,`, `q-count: {on: box, as: root,`, []string{"/spec/solution/answers/q-count"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !strings.Contains(answerLab, tt.old) {
				t.Fatalf("fixture has no %q", tt.old)
			}
			_, err := Compile([]byte(strings.Replace(answerLab, tt.old, tt.new, 1)), Options{})
			if err == nil {
				t.Fatal("compiled")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error does not mention %q:\n%v", w, err)
				}
			}
		})
	}
}
