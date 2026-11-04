package main

import (
	"errors"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func TestKubeletChecks(t *testing.T) {
	good := []byte(`{"kubeletconfig":{"podPidsLimit":4096,"seccompDefault":true}}`)
	none := []byte(`{"kubeletconfig":{"podPidsLimit":-1}}`)
	configz := map[string][]byte{"lab1": good, "lab2": none, "sys1": none}
	read := func(n string) ([]byte, error) {
		if b, ok := configz[n]; ok {
			return b, nil
		}
		return nil, errors.New("forbidden")
	}
	lab := map[string]string{"cloudtrain.dev/pool": "labs"}
	nodes := []corev1.Node{poolNode("lab1", lab), poolNode("lab2", lab), poolNode("sys1", nil)}
	pool, _ := drivers.ParseLabPlacement("cloudtrain.dev/pool=labs", "")

	c := kubeletChecks(nodes, pool, read)
	if c.Status != pfFail || !strings.Contains(c.Message, "lab2: no podPidsLimit, seccompDefault off") || strings.Contains(c.Message, "sys1") {
		t.Errorf("lab pool = %+v", c)
	}
	// Without a lab pool every node is checked, as a warning.
	if c := kubeletChecks(nodes, drivers.LabPlacement{}, read); c.Status != pfWarn || !strings.Contains(c.Message, "sys1") {
		t.Errorf("no pool = %+v", c)
	}
	configz["lab2"] = good
	if c := kubeletChecks(nodes, pool, read); c.Status != pfPass {
		t.Errorf("fixed = %+v", c)
	}
	if c := kubeletChecks([]corev1.Node{poolNode("x", lab)}, pool, read); c.Status != pfFail || !strings.Contains(c.Message, "cannot read") {
		t.Errorf("unreadable = %+v", c)
	}
}
