// Command manager runs the lab-orchestrator controllers.
package main

import (
	"flag"
	"os"

	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/controller"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func main() {
	var (
		metricsAddr, probeAddr, registry, runtimeClass string
		leaderElect                                    bool
	)
	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8080", "metrics endpoint address")
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

	cfg := ctrl.GetConfigOrDie()
	mgr, err := ctrl.NewManager(cfg, ctrl.Options{
		Scheme:                 scheme,
		Metrics:                metricsserver.Options{BindAddress: metricsAddr},
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
		Client: mgr.GetClient(), Scheme: scheme, ImageRegistry: registry,
		RuntimeClassName: runtimeClass, Executor: executor,
	})
	if err != nil {
		log.Error(err, "unable to build driver registry")
		os.Exit(1)
	}

	if err := (&controller.LabSessionReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Drivers: reg,
		Recorder: mgr.GetEventRecorderFor("lab-orchestrator"),
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
