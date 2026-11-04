// Package gate carries the production profile's provisioning gate through a
// reconcile's context, so every place that creates or starts a lab object
// checks it right before the Kubernetes call: pods, Services, PVCs, Secrets,
// the session network (VPC, Subnets, NADs), VMs (created or resumed), and
// vcluster namespaces, policies, installs and scale-ups. Deletes, halts and
// reads are never gated.
//
// Secrets go through drivers.ensure/ensureSecret or carry their own check
// (the session SSH keys, the kubeadm PKI, the vcluster kubeconfig).
//
// Scope: lab objects the manager creates while reconciling a LabSession. It
// does not cover objects created outside that path:
//   - labctl verify and exam runs create namespaces, LabTemplates,
//     LabSessions and ExamSessions only (their steps run by exec into what
//     the manager provisioned); the manager gates their Pods, VMs and
//     Secrets when it reconciles those LabSessions.
//   - labctl preflight --probe creates throwaway probe pods directly, in its
//     own temporary namespaces. It is an operator tool for setting a
//     cluster up; do not run it against production lab namespaces.
//   - the manager's own RoleBindings in lab namespaces (internal/rbac),
//     which are access, not workloads.
package gate

import (
	"context"
	"errors"
	"reflect"
)

// Checker reports why nothing may be created now (nil: go ahead).
type Checker interface {
	Err() error
}

type key struct{}

// errNoGate is what a production context without a checker answers.
var errNoGate = errors.New("the production isolation profile runs without a provisioning gate: nothing is provisioned")

type missing struct{}

func (missing) Err() error { return errNoGate }

// With returns ctx carrying c. Under the production profile a missing c
// (nil, or a typed nil) fails closed: every create is refused. Otherwise a
// missing c means no gate.
func With(ctx context.Context, production bool, c Checker) context.Context {
	if isNil(c) {
		if !production {
			return ctx
		}
		c = missing{}
	}
	return context.WithValue(ctx, key{}, c)
}

// Err is the gate's verdict for ctx (nil without a gate).
func Err(ctx context.Context) error {
	if c, ok := ctx.Value(key{}).(Checker); ok {
		return c.Err()
	}
	return nil
}

func isNil(c Checker) bool {
	if c == nil {
		return true
	}
	v := reflect.ValueOf(c)
	switch v.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Func, reflect.Interface, reflect.Chan:
		return v.IsNil()
	}
	return false
}
