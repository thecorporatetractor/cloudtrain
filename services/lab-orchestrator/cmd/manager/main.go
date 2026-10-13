// Command manager runs the lab-orchestrator controllers.
package main

import (
	"flag"
	"os"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	"sigs.k8s.io/controller-runtime/pkg/metrics/filters"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/controller"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func main() {
	var (
		metricsAddr, probeAddr, registry, runtimeClass, watchNamespace string
		leaderElect, metricsSecure                                     bool
		concurrency                                                    int
		provisionTimeout                                               time.Duration
	)
	flag.StringVar(&metricsAddr, "metrics-bind-address", "0", "metrics endpoint address (e.g. :8443); \"0\" disables metrics")
	flag.BoolVar(&metricsSecure, "metrics-secure", true, "serve metrics over HTTPS with Kubernetes authn/authz")
	flag.StringVar(&watchNamespace, "watch-namespace", "", "restrict the manager to one namespace; empty = all namespaces")
	flag.IntVar(&concurrency, "max-concurrent-reconciles", controller.DefaultMaxConcurrentReconciles, "parallel LabSession reconciles")
	flag.DurationVar(&provisionTimeout, "provision-timeout", controller.DefaultProvisionTimeout, "fail sessions whose nodes are not ready within this time")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "health probe address")
	flag.BoolVar(&leaderElect, "leader-elect", false, "enable leader election")
	flag.StringVar(&registry, "image-registry", "", "registry prefix for catalog images (e.g. registry.cloudtrain.local/images)")
	flag.StringVar(&runtimeClass, "runtime-class", "", "RuntimeClass for container nodes (e.g. kata); empty = cluster default")
	opts := zap.Options{}
	opts.BindFlags(flag.CommandLine)
	flag.Parse()
	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts)))
	log := ctrl.Log.WithName("setup")

	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		panic(err)
	}
	if err := labsv1.AddToScheme(scheme); err != nil {
		panic(err)
	}

	// Only cache the Pods and Services this operator creates, not every one
	// in the cluster.
	managed := labels.SelectorFromSet(labels.Set{drivers.LabelManagedBy: drivers.ManagedBy})
	cacheOpts := cache.Options{ByObject: map[client.Object]cache.ByObject{
		&corev1.Pod{}:     {Label: managed},
		&corev1.Service{}: {Label: managed},
	}}
	if watchNamespace != "" {
		cacheOpts.DefaultNamespaces = map[string]cache.Config{watchNamespace: {}}
	}
	metricsOpts := metricsserver.Options{BindAddress: metricsAddr, SecureServing: metricsSecure}
	if metricsSecure {
		metricsOpts.FilterProvider = filters.WithAuthenticationAndAuthorization
	}

	cfg := ctrl.GetConfigOrDie()
	mgr, err := ctrl.NewManager(cfg, ctrl.Options{
		Scheme:                 scheme,
		Cache:                  cacheOpts,
		Metrics:                metricsOpts,
		HealthProbeBindAddress: probeAddr,
		LeaderElection:         leaderElect,
		LeaderElectionID:       "lab-orchestrator.labs.cloudtrain.dev",
	})
	if err != nil {
		log.Error(err, "unable to create manager")
		os.Exit(1)
	}

	executor, err := drivers.NewRESTPodExecutor(cfg)
	if err != nil {
		log.Error(err, "unable to create pod executor")
		os.Exit(1)
	}
	reg, err := drivers.NewDefaultRegistry(&drivers.ContainerDriver{
		Client: mgr.GetClient(), Reader: mgr.GetAPIReader(), Scheme: scheme, ImageRegistry: registry,
		RuntimeClassName: runtimeClass, Executor: executor,
	})
	if err != nil {
		log.Error(err, "unable to build driver registry")
		os.Exit(1)
	}

	if err := (&controller.LabSessionReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Drivers: reg,
		Recorder:         mgr.GetEventRecorderFor("lab-orchestrator"),
		ProvisionTimeout: provisionTimeout, MaxConcurrentReconciles: concurrency,
	}).SetupWithManager(mgr); err != nil {
		log.Error(err, "unable to set up LabSession controller")
		os.Exit(1)
	}
	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		os.Exit(1)
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		os.Exit(1)
	}
	log.Info("starting manager", "drivers", reg.Names())
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		log.Error(err, "manager exited")
		os.Exit(1)
	}
}
