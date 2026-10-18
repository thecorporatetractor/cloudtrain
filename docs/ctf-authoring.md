# Authoring answer checks and CTF labs

A **CTF lab** (curriculum `type: ctf`) is an investigation: the learner works in
the lab's terminal and answers questions about a seeded incident, dataset or
system. Each question is an **answer check** (`type: answer`) graded on the
answer the learner submits, not on the lab's end state. Answer checks can sit
next to ordinary end-state checks in the same lab (answer the questions, then
fix or block something and validate).

The demo lab is `content/packs/linux/labs/ctf-ticket-gate-breach`: five
sequential questions about a seeded gateway log (exact, computed number,
exact, regex, any-of) with hints and penalties, plus one end-state check.

## The rule that matters: answers come from the session

Every expected answer must differ between learners, so answers cannot be
shared, and must never reach the browser. The compiler and `lab-verify`
enforce both:

- The expected value is either a **secret param** (`secret: true`) referenced
  in `answer.value` / `answer.values`, or **computed** on a lab node right
  after setup (`answer.compute`). A literal answer (`value: "203.0.113.7"`) is
  an error.
- A param an answer references must be `secret: true`. Secret params are
  removed from the session the browser gets, so they must not appear in
  anything the learner reads: the description, objectives, lab hints, check
  descriptions (the questions), question hints and placeholders. Setup,
  check commands, `compute` and the solution may use them.
- `status.computedAnswers` (computed values) and the template (with
  `answer.value`) stay in the cluster and the gateway.

Seed the dataset in setup from params (as the demo does with `awk -v
octet={{octet}} ...`), so the same seed always produces the same data and the
same answers. In events, teammates get the same seed so they see the same
data.

## An answer check

```yaml
  questionOrder: sequential        # or free (default)
  checks:
    - id: q-attacker-ip
      type: answer
      description: Which IP address made the most failed login attempts?   # the question (Markdown)
      skills: [linux.shell.text-processing]
      answer:
        match: exact               # exact | number | regex | any-of
        value: "203.0.113.{{octet}}"   # octet is declared secret: true
        caseSensitive: false       # default false
        whitespace: collapse       # trim | collapse (default) | remove | none
        points: 100                # default 100
        maxAttempts: 5             # wrong answers before the question closes; unlimited if absent
        penalty: 10                # points off the award per wrong answer
        placeholder: 192.0.2.1     # format example in the empty answer box
        hints:
          - {body: "Keep only result=fail lines, then count the ip= values.", cost: 10}
```

An answer check takes no `on`, `command`, `query`, `target` or `expect`; it is
never run by the grader and does not count toward the Validate score.

### Matchers

Answers are normalised first: whitespace per `whitespace` (the whitespace set
is ASCII whitespace plus the no-break space), then lower-cased unless
`caseSensitive`.

| `match` | Expected value | Accepts |
|---|---|---|
| `exact` | `value` or computed output | the normalised answer equals the normalised expected value |
| `number` | `value` or computed output (a decimal number) | a plain decimal number (sign, fraction, exponent; no hex, `Infinity` or thousands separators) within `tolerance` (absolute, default 0) |
| `regex` | `value` (a pattern) or computed output | the normalised answer **fully** matches the pattern (`^(?:...)$`), case-insensitive unless `caseSensitive`. Use the subset Go RE2 and JavaScript share: no lookaround or backreferences. Template values are inserted verbatim; escape dots in IPs and versions (`2\\.{{minor}}`) |
| `any-of` | `values`, or each non-empty line of the computed output | equal to any one of them |

The Go matcher (`services/lab-orchestrator/internal/answer`, used by `labctl
verify`) and the gateway's TypeScript matcher run the same vectors
(`packages/lab-schema/testdata/answer-matchers.json`). Add a vector when a
lab needs a case the vectors do not cover.

### Computed answers

```yaml
      answer:
        match: number
        compute:
          on: tkt-gate-01            # default: the entry node
          command: grep -F "ip=203.0.113.{{octet}} " /var/log/tr-ticketing/gateway.log | grep -c 'result=fail'
          timeoutSec: 30             # default 30, max 300
```

The command runs once per session as admin, right after setup (and again after
a reset). Its stdout, minus one trailing newline, is the expected value. A
non-zero exit, empty output or more than 4 KiB fails the session's setup, so a
broken computation never reaches a learner. Prefer computing from the data the
learner sees rather than duplicating the generator's arithmetic.

### Points, attempts and hints

- A solved question earns `points - penalty x wrong answers - cost of revealed
  question hints`, never below 0.
- After `maxAttempts` wrong answers the question is **closed** (no more
  answers, no points). Without `maxAttempts` the learner can keep trying.
- Question hints are revealed one at a time; the learner confirms the cost
  first. Lab-level `spec.hints` still work as before (they do not cost
  question points).
- `questionOrder: sequential` opens a question once the one before it is
  solved or closed; `free` (default) opens them all.
- In events, dynamic scoring replaces `points` with the event's decaying value
  (see `docs/ctf-events.md`); penalties and hint costs still apply.

## Solution and misconceptions

```yaml
  misconceptions:
    - id: decoy-scanner
      description: Blames the noisy scanner, which only comes second.
      feedback: Count failed logins per address and take the top one.
      expectFail: [q-attacker-ip]
      answers:                       # wrong answers, instead of a mutation
        q-attacker-ip:
          command: grep 'result=fail' ... | sed -n 2p | sed 's/.*ip=//'
    - id: tool-without-version
      description: Names the tool but not its version.
      expectFail: [q-tool]
      answers: {q-tool: python-requests}
  solution:
    steps: [...]                     # needed only when the lab has end-state checks
    answers:                         # one per answer check
      q-attacker-ip:
        command: grep 'result=fail' ... | head -1 | sed 's/.*ip=//'   # as the learner by default
      q-tool: "python-requests/2.{{uaminor}}.0"     # or a templated string
```

- `solution.answers` must answer every answer check. A value is a templated
  string, or `{on, as, command, timeoutSec}` whose trimmed stdout is the
  answer (`as` defaults to `learner`). Prefer commands: they prove the
  question can be answered from what the learner can see.
- A misconception with `answers` gives wrong answers; every check in its
  `expectFail` must have one and must reject it. A misconception uses either
  `mutation` (end-state checks) or `answers`, never both, and a mutation
  cannot target an answer check.

`labctl verify` checks all of this live, in both base runs (two seeds): the
solution answers must be accepted, an empty answer and every misconception
answer rejected, and it warns when a question expects the same answer for
both seeds. Wrong answers need no extra session.

## Curriculum and packs

- `type: ctf` in `content/curriculum.yaml`; `lab-verify` requires a ctf lab to
  have at least one answer check. CTF labs are never exam tasks: exam
  simulations are graded on end state and `labctl exam compile` refuses
  answer checks.
- Like any learning lab, a CTF lab belongs to a path module and a pack course.
- Tag it `ctf` so it can be found when building events.

## Checklist

- [ ] Every answer depends on a secret param or `compute`; no secret param in learner-visible text.
- [ ] The dataset is generated from params in setup (same seed, same data).
- [ ] Each question states the expected format (and `placeholder` shows it).
- [ ] Regex answers: dots escaped, alternatives grouped, RE2/JS-compatible.
- [ ] `solution.answers` derives each answer like a learner would (commands as the learner).
- [ ] At least one wrong-answer misconception per question that has a plausible trap.
- [ ] `labctl validate` and `node tools/lab-verify/bin/lab-verify.mjs --strict` pass; mark `built`; live `labctl verify` runs on the verify VM.
