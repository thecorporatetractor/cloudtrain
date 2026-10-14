package controller

import (
	"context"
	"errors"
	"fmt"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// Condition reasons for access revocation.
const (
	ReasonAccessRevoked  = "AccessRevoked"
	ReasonRevokePending  = "RevokePending"
	ReasonAccessGranted  = "AccessGranted"
	revokeActionTimeoutS = 30
)

// RevokeScript kills every process of the learner account (open shells,
// ssh clients, background jobs). It runs as root on the entry node and on
// every VM node; the account itself stays (grading runs checks as the
// learner).
const RevokeScript = `u=learner
id "$u" >/dev/null 2>&1 || exit 0
pkill -KILL -u "$u" 2>/dev/null
uid=$(id -u "$u")
for d in /proc/[0-9]*; do
  [ "$(awk '/^Uid:/{print $2}' "$d/status" 2>/dev/null)" = "$uid" ] && kill -KILL "${d#/proc/}" 2>/dev/null
done
exit 0`

// accessRevoked reports whether the session is (or must be) frozen for the
// learner. Revocation is sticky: once the condition is True, clearing
// spec.accessRevoked does not restore access.
func accessRevoked(s *labsv1.LabSession) bool {
	return s.Spec.AccessRevoked || meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionAccessRevoked)
}

// revokeTargets are the nodes whose learner processes are killed: the entry
// node, every VM and every kubeadm cluster member.
func revokeTargets(spec *labsv1.LabTemplateSpec) []string {
	var out []string
	if spec.Topology.Entry != "" {
		out = append(out, spec.Topology.Entry)
	}
	for _, n := range spec.Topology.Nodes {
		switch {
		case n.Name == spec.Topology.Entry:
		case n.Driver == labsv1.DriverVM:
			out = append(out, n.Name)
		case n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil && n.Cluster.Mode == labsv1.ClusterModeKubeadm:
			for _, m := range n.Cluster.Nodes {
				out = append(out, n.Name+"/"+m.Name)
			}
		}
	}
	return out
}

// revokeAccess withdraws endpoints and, once, kills the learner's processes
// on every target node. A node that cannot be reached (e.g. a VM that is
// still booting) is retried on the next reconcile; nodes that are gone
// (Failed/Destroyed sessions) count as revoked.
func (r *LabSessionReconciler) revokeAccess(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) error {
	s.Status.Endpoints = nil
	if meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionAccessRevoked) {
		return nil
	}
	ex := &NodeExecutor{Drivers: r.Drivers, Session: s, Template: tpl.spec}
	var errs error
	run := RevokeScript
	for _, on := range revokeTargets(tpl.spec) {
		a := labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &run, TimeoutSec: revokeActionTimeoutS}
		if _, err := ex.RunAction(ctx, a); err != nil && !drivers.IsPermanent(err) {
			errs = errors.Join(errs, err)
		}
	}
	if errs != nil {
		r.setCondition(s, labsv1.ConditionAccessRevoked, metav1.ConditionFalse, ReasonRevokePending, "revoking learner access: "+firstLine(errs.Error()))
		return fmt.Errorf("revoke access: %w", errs)
	}
	r.setCondition(s, labsv1.ConditionAccessRevoked, metav1.ConditionTrue, ReasonAccessRevoked, "learner access revoked; endpoints withdrawn and learner processes ended")
	r.event(s, "Normal", ReasonAccessRevoked, "learner access revoked")
	return nil
}

func firstLine(s string) string {
	for i, c := range s {
		if c == '\n' {
			return s[:i]
		}
	}
	return s
}
