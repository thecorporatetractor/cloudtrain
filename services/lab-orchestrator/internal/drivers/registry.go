package drivers

import (
	"fmt"
	"sort"
	"sync"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Registry maps driver names to implementations.
type Registry struct {
	mu      sync.RWMutex
	drivers map[labsv1.DriverName]NodeDriver
}

// NewRegistry returns a registry holding the given drivers.
func NewRegistry(ds ...NodeDriver) (*Registry, error) {
	r := &Registry{drivers: map[labsv1.DriverName]NodeDriver{}}
	for _, d := range ds {
		if err := r.Register(d); err != nil {
			return nil, err
		}
	}
	return r, nil
}

// Register adds a driver; registering the same name twice is an error.
func (r *Registry) Register(d NodeDriver) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.drivers[d.Name()]; ok {
		return fmt.Errorf("driver %q already registered", d.Name())
	}
	r.drivers[d.Name()] = d
	return nil
}

// Get returns the driver for name.
func (r *Registry) Get(name labsv1.DriverName) (NodeDriver, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[name]
	if !ok {
		return nil, fmt.Errorf("no driver registered for %q: %w", name, ErrUnsupported)
	}
	return d, nil
}

// Names lists registered driver names, sorted.
func (r *Registry) Names() []labsv1.DriverName {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]labsv1.DriverName, 0, len(r.drivers))
	for n := range r.drivers {
		out = append(out, n)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// NewDefaultRegistry registers the given container driver plus the vm,
// k8s-cluster (virtual/kubeadm) and netdev drivers.
func NewDefaultRegistry(container *ContainerDriver) (*Registry, error) {
	return NewRegistry(container, NewVMDriver(), NewClusterDriver(), NewNetdevDriver())
}
