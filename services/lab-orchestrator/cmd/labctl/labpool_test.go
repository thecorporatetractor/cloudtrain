package main

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func poolNode(name string, lbl map[string]string, taints ...corev1.Taint) corev1.Node {
	return corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: name, Labels: lbl}, Spec: corev1.NodeSpec{Taints: taints}}
}

func TestLabPoolChecks(t *testing.T) {
	p, err := drivers.ParseLabPlacement("cloudtrain.dev/pool=labs", "cloudtrain.dev/labs=true:NoSchedule")
	if err != nil {
		t.Fatal(err)
	}
	labTaint := corev1.Taint{Key: "cloudtrain.dev/labs", Value: "true", Effect: corev1.TaintEffectNoSchedule}
	sysTaint := corev1.Taint{Key: "CriticalAddonsOnly", Value: "true", Effect: corev1.TaintEffectNoSchedule}
	lab := map[string]string{"cloudtrain.dev/pool": "labs"}
	status := func(cs []pfCheck, name string) string {
		for _, c := range cs {
			if c.Name == name {
				return c.Status
			}
		}
		return ""
	}
	good := labPoolChecks([]corev1.Node{poolNode("lab1", lab, labTaint), poolNode("sys1", nil, sysTaint)}, p)
	if status(good, "lab-pool") != pfPass || status(good, "system-pool") != pfPass {
		t.Errorf("good = %+v", good)
	}
	bad := labPoolChecks([]corev1.Node{poolNode("lab1", lab), poolNode("sys1", nil)}, p)
	if status(bad, "lab-pool") != pfFail || status(bad, "system-pool") != pfFail {
		t.Errorf("bad = %+v", bad)
	}
	zero := labPoolChecks([]corev1.Node{poolNode("sys1", nil, sysTaint)}, p)
	if status(zero, "lab-pool") != pfWarn || status(zero, "system-pool") != pfPass {
		t.Errorf("scaled to zero = %+v", zero)
	}
	if labPoolChecks(nil, drivers.LabPlacement{}) != nil {
		t.Error("no lab pool configured: no checks")
	}
}
