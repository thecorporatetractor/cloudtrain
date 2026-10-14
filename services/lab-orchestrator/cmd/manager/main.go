// Command manager runs the lab-orchestrator controllers.
package main

import (
	"flag"
	"os"
	"strings"
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
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func main() {
	var (
		metricsAddr, probeAddr, registry, runtimeClass, watchNamespace      string
		catalogPaths, adminImageRef, helmBin, vclusterChart, vclusterValues string
		sessionSelector, leaderElectionID, netToolsImage                    string
		storageClass, vmDisks                                               string
		leaderElect, metricsSecure, persistentHome, vclusterPersistence     bool
		concurrency                                                         int
		provisionTimeout                                                    time.Duration
	)
	flag.StringVar(&metricsAddr, "metrics-bind-address", "0", "metrics endpoint address (e.g. :8443); \"0\" disables metrics")
	flag.BoolVar(&metricsSecure, "metrics-secure", true, "serve metrics over HTTPS with Kubernetes authn/authz")
	flag.StringVar(&watchNamespace, "watch-namespace", "", "restrict the manager to one namespace; empty = all namespaces")
	flag.IntVar(&concurrency, "max-concurrent-reconciles", controller.DefaultMaxConcurrentReconciles, "parallel LabSession reconciles")
	flag.DurationVar(&provisionTimeout, "provision-timeout", controller.DefaultProvisionTimeout, "fail sessions whose nodes are not ready within this time")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "health probe address")
	flag.BoolVar(&leaderElect, "leader-elect", false, "enable leader election")
	flag.StringVar(&registry, "image-registry", "", "registry prefix for catalog images (e.g. registry.cloudtrain.local/images)")
	flag.StringVar(&netToolsImage, "net-tools-image", "nettools:1", "catalog image for link init/sidecar containers (iproute2, tc, tcpdump)")
	flag.StringVar(&runtimeClass, "runtime-class", "", "RuntimeClass for container nodes (e.g. kata); empty = cluster default")
	flag.StringVar(&catalogPaths, "image-catalog", "/etc/cloudtrain/catalog", "image catalog files or directories, comma separated; later ones override earlier ones")
	flag.StringVar(&adminImageRef, "admin-image-ref", "jumphost:1", "catalog ref of the entry node's admin sidecar image")
	flag.StringVar(&helmBin, "helm", "helm", "helm binary used to install virtual clusters")
	flag.StringVar(&vclusterChart, "vcluster-chart", "/opt/cloudtrain/charts/vcluster.tgz", "vcluster Helm chart (.tgz or reference)")
	flag.StringVar(&vclusterValues, "vcluster-values", "/opt/cloudtrain/charts/vcluster-values.yaml", "base values for virtual clusters (deploy/vcluster/values.yaml); empty = none")
	flag.StringVar(&sessionSelector, "session-selector", "", "only reconcile LabSessions matching this label selector (e.g. labs.cloudtrain.dev/verify=true); empty = all")
	flag.StringVar(&leaderElectionID, "leader-election-id", "lab-orchestrator.labs.cloudtrain.dev", "leader election lease name")
	flag.BoolVar(&persistentHome, "persistent-home", true, "give container nodes a PVC for /home/learner (survives hibernate/resume)")
	flag.BoolVar(&vclusterPersistence, "vcluster-persistence", true, "keep vcluster databases on a PVC (vclusters can hibernate)")
	flag.StringVar(&vmDisks, "vm-disks", "persistent", "VM root disks: persistent (CDI DataVolume per VM, VMs can hibernate) or ephemeral (containerDisk)")
	flag.StringVar(&storageClass, "storage-class", "", "StorageClass of learner homes, vcluster databases and VM disks; empty = cluster default")
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
	if sessionSelector != "" {
		sel, err := labels.Parse(sessionSelector)
		if err != nil {
			log.Error(err, "invalid --session-selector")
			os.Exit(1)
		}
		cacheOpts.ByObject[&labsv1.LabSession{}] = cache.ByObject{Label: sel}
		// Pools carry the same labels (pooled sessions inherit them).
		cacheOpts.ByObject[&labsv1.WarmPool{}] = cache.ByObject{Label: sel}
		// Exam attempts too (their environment sessions inherit their labels).
		cacheOpts.ByObject[&labsv1.ExamSession{}] = cache.ByObject{Label: sel}
	}
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
		LeaderElectionID:       leaderElectionID,
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
	catalog, err := drivers.LoadCatalog(strings.Split(catalogPaths, ",")...)
	if err != nil {
		log.Error(err, "unable to load image catalog")
		os.Exit(1)
	}
	if vmDisks != "persistent" && vmDisks != "ephemeral" {
		log.Error(nil, "--vm-disks must be persistent or ephemeral", "value", vmDisks)
		os.Exit(1)
	}
	rt, err := drivers.NewRuntime(drivers.RuntimeOptions{
		Client: mgr.GetClient(), Reader: mgr.GetAPIReader(), Scheme: scheme, Executor: executor,
		Catalog: catalog, ImageRegistry: registry, RuntimeClassName: runtimeClass, AdminImageRef: adminImageRef,
		Helm: drivers.ExecHelm{Binary: helmBin}, VClusterChart: vclusterChart, VClusterValues: vclusterValues,
		PersistentHome: persistentHome, VClusterPersistence: vclusterPersistence, StorageClass: storageClass,
		VMDisks: drivers.VMDiskOptions{Persistent: vmDisks == "persistent"},
	})
	if err != nil {
		log.Error(err, "unable to build drivers")
		os.Exit(1)
	}
	reg := rt.Registry
	// Lab network (Kube-OVN VPC + Multus link segments) for container and netdev nodes.
	toolsImage := netToolsImage
	if img, err := catalog.Resolve(netToolsImage, drivers.ImageKindContainer); err == nil {
		toolsImage = img.Image
	}
	rt.Container.Network = &drivers.LinkNetwork{
		Manager:    &network.Manager{Client: mgr.GetClient()},
		ToolsImage: rt.Container.ImageFor(toolsImage),
	}
	reg.Replace(drivers.NewNetdev(rt.Container))

	poolMetrics := controller.NewPoolMetrics()
	poolMetrics.Register()
	if err := (&controller.LabSessionReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Drivers: reg,
		Recorder:         mgr.GetEventRecorderFor("lab-orchestrator"),
		ProvisionTimeout: provisionTimeout, MaxConcurrentReconciles: concurrency,
		Session: rt.Session, Reader: mgr.GetAPIReader(), Metrics: poolMetrics,
	}).SetupWithManager(mgr); err != nil {
		log.Error(err, "unable to set up LabSession controller")
		os.Exit(1)
	}
	if err := (&controller.WarmPoolReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Recorder: mgr.GetEventRecorderFor("lab-orchestrator"),
		Metrics: poolMetrics,
	}).SetupWithManager(mgr); err != nil {
		log.Error(err, "unable to set up WarmPool controller")
		os.Exit(1)
	}
	if err := (&controller.ExamSessionReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Drivers: reg,
		Recorder: mgr.GetEventRecorderFor("lab-orchestrator"),
	}).SetupWithManager(mgr); err != nil {
		log.Error(err, "unable to set up ExamSession controller")
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
