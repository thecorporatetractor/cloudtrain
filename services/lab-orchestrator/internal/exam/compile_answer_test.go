package exam

import (
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func TestTaskIssuesRefuseAnswerChecks(t *testing.T) {
	lt := &labsv1.LabTemplate{Spec: labsv1.LabTemplateSpec{
		Source: labsv1.LabSource{ID: "t1"},
		Checks: []labsv1.Check{{ID: "ok", Type: "shell"}, {ID: "q", Type: labsv1.CheckTypeAnswer}},
	}}
	got := taskIssues(lt)
	if len(got) != 1 || !strings.Contains(got[0], "task t1 check q: answer checks are not allowed in exam tasks") {
		t.Errorf("issues = %v", got)
	}
}
