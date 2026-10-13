package drivers

// Replace registers d, replacing any driver of the same name (e.g. the real
// netdev driver over its stub in the default registry).
func (r *Registry) Replace(d NodeDriver) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.drivers[d.Name()] = d
}
