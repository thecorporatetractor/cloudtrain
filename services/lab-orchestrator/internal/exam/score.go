package exam

import (
	"math"
	"strconv"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/grader"
)

// Learner-safe report messages beyond the grader's own.
const (
	MsgFailedOnRerun     = "no longer satisfied after the idempotency re-run"
	MsgRerunFailed       = "the idempotency re-run failed"
	MsgFailedAfterReboot = "not satisfied after the reboot"
	MsgNotGraded         = "the check could not run"
)

// ScoredTask is a task plus the check definitions the report needs.
type ScoredTask struct {
	Status labsv1.ExamTaskStatus
	Checks []labsv1.Check // the task's own (unprefixed) checks, resolved
}

// Score turns the grading passes into the score report.
//
//   - A check passes when it passed in every pass that ran (initial, then
//     rerun, then reboot) and its task's re-run did not fail.
//   - Task score: per-check = weighted share of passed checks; per-task and
//     none = 100 when every check passed, else 0.
//   - Objective score = mean of its task scores; total = sum of task scores
//     weighted by task weight (objective weight split evenly over its tasks,
//     objective weights normalised over drawn objectives), i.e. the sum of
//     objective scores weighted by objective weight.
//   - Passed = total >= passMark (both rounded to one decimal place).
func Score(spec *labsv1.ExamTemplateSpec, tasks []ScoredTask, g *labsv1.ExamGradingStatus, now metav1.Time) *labsv1.ExamScoreReport {
	passes := map[string]map[string]labsv1.CheckResult{}
	var order []string
	if g != nil {
		for _, p := range g.Passes {
			m := map[string]labsv1.CheckResult{}
			for _, c := range p.Checks {
				m[c.ID] = c
			}
			passes[p.Name] = m
			order = append(order, p.Name)
		}
	}
	rerunFailed := map[int32]bool{}
	if g != nil {
		for _, r := range g.Reruns {
			if !r.OK {
				rerunFailed[r.Task] = true
			}
		}
	}
	credit := spec.Rules.PartialCredit
	if credit == "" {
		credit = labsv1.PartialCreditPerCheck
	}
	rep := &labsv1.ExamScoreReport{PassMark: spec.PassMark, PartialCredit: credit, Passes: order, GradedAt: now}

	objSum := map[string]float64{}
	objN := map[string]int32{}
	total := 0.0
	for _, t := range tasks {
		tr := labsv1.ExamTaskReport{
			Index: t.Status.Index, ID: t.Status.ID, Title: t.Status.Title, Objective: t.Status.Objective,
			Weight: t.Status.Weight,
		}
		var got, all float64
		allPassed := len(t.Checks) > 0
		for _, c := range t.Checks {
			id := CheckID(t.Status.Index, c.ID)
			cr := labsv1.ExamCheckReport{ID: c.ID, Description: c.Description, Weight: c.Weight, Skills: c.Skills}
			initial, graded := passes[labsv1.PassInitial][id]
			switch {
			case !graded:
				cr.Message = MsgNotGraded
			default:
				cr.Passed, cr.Message = initial.Passed, initial.Message
				if rr, ok := passes[labsv1.PassRerun][id]; ok || rerunFailed[t.Status.Index] {
					switch {
					case rerunFailed[t.Status.Index]:
						cr.FailedOnRerun = cr.Passed
						cr.Passed = false
						cr.Message = MsgRerunFailed
					case cr.Passed && !rr.Passed:
						cr.FailedOnRerun, cr.Passed, cr.Message = true, false, MsgFailedOnRerun
					}
				}
				if rb, ok := passes[labsv1.PassReboot][id]; ok && cr.Passed && !rb.Passed {
					cr.FailedAfterReboot, cr.Passed, cr.Message = true, false, MsgFailedAfterReboot
				}
			}
			if cr.Message == "" {
				cr.Message = grader.MsgFailed
				if cr.Passed {
					cr.Message = grader.MsgPassed
				}
			}
			w := parseWeight(c.Weight)
			all += w
			if cr.Passed {
				got += w
			} else {
				allPassed = false
			}
			tr.Checks = append(tr.Checks, cr)
		}
		score := 0.0
		switch credit {
		case labsv1.PartialCreditPerCheck:
			if all > 0 {
				score = 100 * got / all
			}
		default:
			if allPassed {
				score = 100
			}
		}
		score = round1(score)
		tr.Score = fmtNum(score)
		switch {
		case score >= 100:
			tr.Outcome = labsv1.OutcomePass
		case score <= 0:
			tr.Outcome = labsv1.OutcomeFail
		default:
			tr.Outcome = labsv1.OutcomePartial
		}
		objSum[t.Status.Objective] += score
		objN[t.Status.Objective]++
		rep.Tasks = append(rep.Tasks, tr)
	}
	weights := ObjectiveWeights(spec)
	for _, o := range spec.Objectives {
		if o.Tasks <= 0 {
			continue
		}
		or := labsv1.ExamObjectiveReport{ID: o.ID, Weight: fmtNum(round1(weights[o.ID])), Tasks: objN[o.ID]}
		if objN[o.ID] > 0 {
			mean := objSum[o.ID] / float64(objN[o.ID])
			or.Score = fmtNum(round1(mean))
			total += weights[o.ID] * mean / 100
		} else {
			or.Score = "0"
		}
		rep.Objectives = append(rep.Objectives, or)
	}
	total = round1(total)
	rep.Score = fmtNum(total)
	rep.Passed = total >= round1(parseWeight(spec.PassMark))
	return rep
}

// FormatWeight renders a task weight for status.
func FormatWeight(w float64) string { return fmtNum(math.Round(w*100) / 100) }

func parseWeight(s string) float64 {
	if s == "" {
		return 1
	}
	w, err := strconv.ParseFloat(s, 64)
	if err != nil || w < 0 {
		return 0
	}
	return w
}

func round1(x float64) float64 { return math.Round(x*10) / 10 }

func fmtNum(x float64) string { return strconv.FormatFloat(x, 'f', -1, 64) }
