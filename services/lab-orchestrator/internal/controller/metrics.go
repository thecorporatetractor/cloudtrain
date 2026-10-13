package controller

import (
	"github.com/prometheus/client_golang/prometheus"
	"sigs.k8s.io/controller-runtime/pkg/metrics"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// PoolMetrics are the warm pool gauges and claim counters, served on the
// manager's metrics endpoint (--metrics-bind-address).
type PoolMetrics struct {
	sessions *prometheus.GaugeVec
	desired  *prometheus.GaugeVec
	claims   *prometheus.CounterVec
}

// NewPoolMetrics creates the metrics; register them once with Register.
func NewPoolMetrics() *PoolMetrics {
	return &PoolMetrics{
		sessions: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "cloudtrain_warmpool_sessions",
			Help: "Pooled lab sessions per WarmPool by state (ready, provisioning, claimed).",
		}, []string{"namespace", "pool", "state"}),
		desired: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "cloudtrain_warmpool_size",
			Help: "Desired number of ready, unclaimed sessions per WarmPool (spec.size).",
		}, []string{"namespace", "pool"}),
		claims: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cloudtrain_warmpool_claims_total",
			Help: "Claims of pooled sessions by result (claimed, exhausted = provisioned cold).",
		}, []string{"namespace", "pool", "result"}),
	}
}

// Register adds the metrics to the controller-runtime registry.
func (m *PoolMetrics) Register() {
	metrics.Registry.MustRegister(m.sessions, m.desired, m.claims)
}

func (m *PoolMetrics) observe(p *labsv1.WarmPool) {
	m.sessions.WithLabelValues(p.Namespace, p.Name, "ready").Set(float64(p.Status.Ready))
	m.sessions.WithLabelValues(p.Namespace, p.Name, "provisioning").Set(float64(p.Status.Provisioning))
	m.sessions.WithLabelValues(p.Namespace, p.Name, "claimed").Set(float64(p.Status.Claimed))
	m.desired.WithLabelValues(p.Namespace, p.Name).Set(float64(p.Spec.Size))
}

func (m *PoolMetrics) forget(ns, name string) {
	for _, st := range []string{"ready", "provisioning", "claimed"} {
		m.sessions.DeleteLabelValues(ns, name, st)
	}
	m.desired.DeleteLabelValues(ns, name)
}

func (m *PoolMetrics) claimed(ns, pool string, ok bool) {
	result := "claimed"
	if !ok {
		result = "exhausted"
	}
	m.claims.WithLabelValues(ns, pool, result).Inc()
}
