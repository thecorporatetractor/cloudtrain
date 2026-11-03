// Command manager runs the lab-orchestrator controllers.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	nodev1 "k8s.io/api/node/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/discovery"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
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
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/rbac"
)

func main() {
	var (
		metricsAddr, probeAddr, registry, runtimeClass, watchNamespace                                            string
		catalogPaths, adminImageRef, helmBin, vclusterChart, vclusterValues                                       string
		sessionSelector, leaderElectionID, netToolsImage                                                          string
		storageClass, homeStorageClass, vmDiskStorageClass, vmDiskVolumeMode, vmDiskAccessModes, storagePreflight string
		vmDisks, userNamespaces, vclusterPodSecurity, tierRuntimeClasses                                          string
		sandboxesFlag, sandboxesConfig, sandboxPreflight                                                          string
		sandboxTTL                                                                                                time.Duration
		ovnCentral, imageMirrors, imagePullSecrets, networkModeFlag                                               string
		sessionClusterRole, serviceAccount, podAdmissionPolicy                                                    string
		labMTU                                                                                                    int
		linkSysctls                                                                                               bool
		linkRateMbps                                                                                              int
		leaderElect, metricsSecure, persistentHome, vclusterPersistence                                           bool
		allowLearnerSudo                                                                                          bool
		concurrency                                                                                               int
		provisionTimeout                                                                                          time.Duration
	)
	flag.StringVar(&metricsAddr, "metrics-bind-address", "0", "metrics endpoint address (e.g. :8443); \"0\" disables metrics")
	flag.BoolVar(&metricsSecure, "metrics-secure", true, "serve metrics over HTTPS with Kubernetes authn/authz")
	flag.StringVar(&watchNamespace, "watch-namespace", "", "restrict the manager to one namespace; empty = all namespaces")
	flag.IntVar(&concurrency, "max-concurrent-reconciles", controller.DefaultMaxConcurrentReconciles, "parallel LabSession reconciles")
	flag.DurationVar(&provisionTimeout, "provision-timeout", controller.DefaultProvisionTimeout, "fail sessions whose nodes are not ready within this time")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "health probe address")
	flag.BoolVar(&leaderElect, "leader-elect", false, "enable leader election")
	flag.StringVar(&registry, "image-registry", "", "registry prefix for unqualified catalog images (e.g. registry.cloudtrain.local/images); empty = the catalog's registry")
	flag.StringVar(&imageMirrors, "image-mirror", "", "registry rewrites for resolved lab images, from=to comma separated (e.g. ghcr.io/acme/cloudtrain=acme.azurecr.io/cloudtrain,docker.io=mirror.gcr.io); added to the catalog's mirrors")
	flag.StringVar(&imagePullSecrets, "image-pull-secrets", "", "Secrets in the session namespace that lab pods (and ephemeral VM containerDisks: the first one) pull with, comma separated; added to the catalog's imagePullSecrets")
	flag.StringVar(&netToolsImage, "net-tools-image", "nettools:1", "catalog image for link init/sidecar containers (iproute2, tc, tcpdump)")
	flag.StringVar(&runtimeClass, "runtime-class", "", "RuntimeClass for container nodes (e.g. kata); empty = cluster default")
	flag.StringVar(&sandboxesFlag, "sandboxes", "", "tier sandboxes (docs/kata-spike.md): <tier>=<RuntimeClass>[:kubevirt|:fail] comma separated, e.g. B=kata-clh-runtime-rs; container nodes of that tier's catalog images run in the RuntimeClass (systemd and privileged images only there); while it is unavailable, fallback kubevirt (default) runs nodes whose image has a catalog vmFallback as that KubeVirt VM, fail leaves them to fail. Overrides tiers of --sandboxes-config; empty = off")
	flag.StringVar(&sandboxesConfig, "sandboxes-config", "", "SandboxConfig file (Helm orchestrator.sandboxes; a ConfigMap mount, sandboxes.yaml): tiers with runtimeClass, fallback, requiredFeatures; a missing file = no tiers")
	flag.StringVar(&sandboxPreflight, "sandbox-preflight", "", "SandboxPreflight file written by labctl preflight --sandbox-configmap (a ConfigMap mount, preflight.yaml): a tier the preflight failed is unavailable, a handler it proved a VM is trusted; a missing file = none")
	flag.DurationVar(&sandboxTTL, "sandbox-recheck", drivers.DefaultSandboxTTL, "how often the tier sandboxes' availability (RuntimeClass, handler, schedulable nodes) is re-checked")
	flag.StringVar(&tierRuntimeClasses, "tier-runtime-classes", "", "deprecated (the phase-0 prototype): the same as --sandboxes with fallback fail, e.g. B=kata-clh")
	flag.StringVar(&catalogPaths, "image-catalog", "/etc/cloudtrain/catalog", "image catalog files or directories, comma separated; later ones override earlier ones")
	flag.StringVar(&adminImageRef, "admin-image-ref", "jumphost:1", "catalog ref of the entry node's admin sidecar image")
	flag.StringVar(&helmBin, "helm", "helm", "helm binary used to install virtual clusters")
	flag.StringVar(&vclusterChart, "vcluster-chart", "/opt/cloudtrain/charts/vcluster.tgz", "vcluster Helm chart (.tgz or reference)")
	flag.StringVar(&vclusterValues, "vcluster-values", "/opt/cloudtrain/charts/vcluster-values.yaml", "base values for virtual clusters (deploy/vcluster/values.yaml); empty = none")
	flag.StringVar(&sessionSelector, "session-selector", "", "only reconcile LabSessions matching this label selector (e.g. labs.cloudtrain.dev/verify=true); empty = all")
	flag.StringVar(&leaderElectionID, "leader-election-id", "lab-orchestrator.labs.cloudtrain.dev", "leader election lease name")
	flag.StringVar(&userNamespaces, "user-namespaces", "auto", "run catalog images marked userNamespace (tier A) with pod hostUsers: false: auto (when every node's runtime handler reports support), true, false")
	flag.BoolVar(&persistentHome, "persistent-home", true, "give container nodes a PVC for /home/learner (survives hibernate/resume)")
	flag.BoolVar(&vclusterPersistence, "vcluster-persistence", true, "keep vcluster databases on a PVC (vclusters can hibernate)")
	flag.StringVar(&vmDisks, "vm-disks", "persistent", "VM root disks: persistent (CDI DataVolume per VM, VMs can hibernate) or ephemeral (containerDisk)")
	flag.StringVar(&vclusterPodSecurity, "vcluster-pod-security", drivers.PodSecurityBaseline, "Pod Security Standard enforced on vcluster host namespaces, where learners' virtual-cluster pods run: baseline or restricted (restricted also rejects the vcluster control plane unless the values make it non-root)")
	flag.StringVar(&ovnCentral, "ovn-central", "kube-system/app=ovn-central", "Kube-OVN central pods (<namespace>/<label>=<value>) to set vlan-passthru on lab link switches with ovn-nbctl; empty = links drop 802.1Q-tagged frames")
	flag.BoolVar(&linkSysctls, "link-sysctls", true, "run wired lab pods (topology links) in a user namespace with writable network sysctls (ip_forward, rp_filter, accept_ra, proxy_arp, ping_group_range) when user namespaces are available (--user-namespaces); false (or no user namespaces) = read-only /proc/sys in every container, and routers (netdev nodes) get their sysctls from the CNI tuning plugin, which every node then needs")
	flag.IntVar(&linkRateMbps, "link-rate-mbps", 10, "rate limit of every lab link attachment in Mbit/s, each direction (Kube-OVN ingress_rate/egress_rate: OVS policing and an HTB queue on the host side of the port, out of the learner's reach), so a bridging loop cannot saturate the host; 0 = none")
	flag.BoolVar(&allowLearnerSudo, "allow-learner-sudo", true, "allow labs whose entry node sets learnerSudo (the learner may escalate to root in that unprivileged container); false fails such sessions")
	flag.StringVar(&networkModeFlag, "network-mode", string(network.ModePrimary), "how wired lab pods and lab VMs reach the session network (docs/any-kubernetes.md): primary (Kube-OVN is the cluster's primary CNI; eth0 placed with ovn.kubernetes.io/logical_switch) or secondary (another CNI owns eth0, Kube-OVN runs non-primary behind Multus; eth0 = a session segment as the Multus default network, VMs with multus.default)")
	flag.IntVar(&labMTU, "lab-mtu", network.DefaultLinkMTU, "MTU of every session segment (Kube-OVN Subnet spec.mtu): lab links, management, lab and access subnets; lab content assumes 1400. 0 = Kube-OVN default (node MTU minus tunnel overhead)")
	flag.StringVar(&storageClass, "storage-class", "", "StorageClass of learner homes, vcluster databases and VM disks; empty = cluster default")
	flag.StringVar(&homeStorageClass, "home-storage-class", "", "StorageClass of learner homes and vcluster databases; empty = --storage-class")
	flag.StringVar(&vmDiskStorageClass, "vm-disk-storage-class", "", "StorageClass of VM disks; empty = --storage-class")
	flag.StringVar(&vmDiskVolumeMode, "vm-disk-volume-mode", "", "volumeMode of VM disks: Block, Filesystem, or empty = the class's CDI StorageProfile decides")
	flag.StringVar(&vmDiskAccessModes, "vm-disk-access-modes", "ReadWriteOnce", "comma separated accessModes of VM disks (ReadWriteOnce suits every class)")
	flag.StringVar(&storagePreflight, "storage-preflight", "warn", "startup check that the configured (or a default) StorageClass exists: warn (log), strict (exit on a missing configured class) or off")
	flag.StringVar(&sessionClusterRole, "session-cluster-role", rbac.DefaultSessionClusterRole, "ClusterRole with the manager's permissions inside lab namespaces (config/rbac/session_role.yaml); the manager binds it to itself in every namespace labelled "+drivers.LabelLabNamespace+"=true it works in. Empty = never bind (the operator grants those permissions)")
	flag.StringVar(&podAdmissionPolicy, "pod-admission-policy", "", "the lab pod admission policy (config/rbac/pod_admission_policy.yaml; ValidatingAdmissionPolicy and binding of this name) checked at startup: missing = the manager does not start, unless the API server lacks ValidatingAdmissionPolicy (Kubernetes < 1.30: a warning). Empty = not checked (a warning)")
	flag.StringVar(&serviceAccount, "service-account", "", "the manager's own ServiceAccount, <namespace>/<name>, the subject of those RoleBindings; empty = $POD_NAMESPACE/$SERVICE_ACCOUNT_NAME (downward API)")
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
		Scheme: scheme,
		Cache:  cacheOpts,
		// Reads of anything but the cached kinds above (and the labs CRDs) go
		// to the API server: an informer would list and watch the kind in
		// every namespace, which the scoped RBAC does not allow (Secrets,
		// PVCs, ... are readable only in lab namespaces).
		Client:                 client.Options{Cache: &client.CacheOptions{DisableFor: uncached()}},
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
	mirrors, err := drivers.ParseRegistryMirrors(imageMirrors)
	if err != nil {
		log.Error(err, "invalid --image-mirror")
		os.Exit(1)
	}
	var pullSecrets []string
	for _, s := range strings.Split(imagePullSecrets, ",") {
		if s = strings.TrimSpace(s); s != "" {
			pullSecrets = append(pullSecrets, s)
		}
	}
	if !drivers.ValidPodSecurity(vclusterPodSecurity) {
		log.Error(nil, "--vcluster-pod-security must be baseline or restricted", "value", vclusterPodSecurity)
		os.Exit(1)
	}
	if vmDisks != "persistent" && vmDisks != "ephemeral" {
		log.Error(nil, "--vm-disks must be persistent or ephemeral", "value", vmDisks)
		os.Exit(1)
	}
	if !drivers.ValidVolumeMode(vmDiskVolumeMode) || !drivers.ValidAccessModes(drivers.SplitList(vmDiskAccessModes)) {
		log.Error(nil, "invalid --vm-disk-volume-mode or --vm-disk-access-modes", "volumeMode", vmDiskVolumeMode, "accessModes", vmDiskAccessModes)
		os.Exit(1)
	}
	if storagePreflight != "warn" && storagePreflight != "strict" && storagePreflight != "off" {
		log.Error(nil, "--storage-preflight must be warn, strict or off", "value", storagePreflight)
		os.Exit(1)
	}
	if storagePreflight != "off" {
		direct, err := client.New(cfg, client.Options{Scheme: scheme})
		if err != nil {
			log.Error(err, "unable to create client for the storage preflight")
			os.Exit(1)
		}
		want := map[string]string{}
		if persistentHome || vclusterPersistence {
			want["homes and vcluster databases"] = firstNonEmpty(homeStorageClass, storageClass)
		}
		if vmDisks == "persistent" {
			want["VM disks"] = firstNonEmpty(vmDiskStorageClass, storageClass)
		}
		pctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		findings := drivers.CheckStorage(pctx, direct, want)
		cancel()
		for _, f := range findings {
			if f.Fatal && storagePreflight == "strict" {
				log.Error(nil, f.Message)
				os.Exit(1)
			}
			log.Info("storage preflight: " + f.Message)
		}
	}
	useUserNS := false
	switch userNamespaces {
	case "true":
		useUserNS = true
	case "false":
	case "auto":
		direct, err := client.New(cfg, client.Options{Scheme: scheme})
		if err != nil {
			log.Error(err, "unable to create client for user namespace detection")
			os.Exit(1)
		}
		var why string
		useUserNS, why = drivers.DetectUserNamespaces(context.Background(), direct, runtimeClass)
		log.Info("user namespaces for tier-A container nodes", "enabled", useUserNS, "reason", why)
	default:
		log.Error(nil, "--user-namespaces must be auto, true or false", "value", userNamespaces)
		os.Exit(1)
	}
	sandboxes, err := loadSandboxes(sandboxesFlag, tierRuntimeClasses, sandboxesConfig, sandboxPreflight)
	if err != nil {
		log.Error(err, "invalid sandbox configuration")
		os.Exit(1)
	}
	if sandboxes.Enabled() {
		direct, err := client.New(cfg, client.Options{Scheme: scheme})
		if err != nil {
			log.Error(err, "unable to create client for sandbox detection")
			os.Exit(1)
		}
		sandboxes.Reader, sandboxes.TTL, sandboxes.Log = direct, sandboxTTL, ctrl.Log.WithName("sandboxes")
		// The KubeVirt fallback needs KubeVirt: without it a tier falls
		// back to "fail" (the node keeps failing with a clear message).
		if !kubeVirtServed(cfg) {
			for t, v := range sandboxes.Tiers {
				if v.FallbackMode() == drivers.SandboxFallbackKubeVirt {
					v.Fallback = drivers.SandboxFallbackFail
					sandboxes.Tiers[t] = v
					log.Info("KubeVirt is not installed: tier sandbox fallback kubevirt becomes fail", "tier", t)
				}
			}
		}
		if err := catalog.CheckVMFallbacks(); err != nil {
			log.Error(err, "catalog vmFallback refs are broken: those images cannot fall back to a VM")
		}
		// Startup validation: every tier is checked and logged; an
		// unavailable tier is dropped from sandboxing (fallback or refusal)
		// until a re-check finds it, and sessions show it in their Sandboxed
		// condition.
		states := sandboxes.Check(context.Background())
		log.Info("tier sandboxes", "tiers", drivers.FormatSandboxStates(states), "preflight", sandboxes.Preflight != nil)
	} else {
		log.Info("tier sandboxes: off (no --sandboxes or sandbox config)")
	}
	{
		direct, err := client.New(cfg, client.Options{Scheme: scheme})
		if err != nil {
			log.Error(err, "unable to create client for the pod admission policy check")
			os.Exit(1)
		}
		pctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		res, err := drivers.CheckPodPolicy(pctx, direct, admissionPolicyServed(cfg), podAdmissionPolicy, sandboxes.SandboxRuntimeClasses())
		cancel()
		if err != nil {
			log.Error(err, "lab pod admission policy")
			os.Exit(1)
		}
		for _, w := range res.Warnings {
			log.Info("WARNING: " + w)
		}
		if res.Info != "" {
			log.Info(res.Info)
		}
	}
	netMode, err := network.ParseMode(networkModeFlag)
	if err != nil {
		log.Error(err, "invalid --network-mode")
		os.Exit(1)
	}
	if labMTU != 0 && (labMTU < 576 || labMTU > 9000) {
		log.Error(nil, "--lab-mtu must be 0 or 576-9000", "value", labMTU)
		os.Exit(1)
	}
	// Without user namespaces nothing in a wired pod can write network
	// sysctls (no container is privileged), so routers take theirs from the
	// CNI tuning plugin.
	netOpts := network.Options{Mode: netMode, MTU: labMTU, RouterTuning: !(linkSysctls && useUserNS)}
	routerSysctls := "user namespace"
	if netOpts.RouterTuning {
		routerSysctls = "CNI tuning plugin (needs the tuning binary of containernetworking/plugins on every node)"
	}
	log.Info("lab network", "mode", netMode, "segmentMTU", labMTU, "routerSysctls", routerSysctls)
	var access *rbac.SessionAccess
	if sessionClusterRole != "" {
		saNS, saName, err := ownServiceAccount(serviceAccount)
		if err != nil {
			log.Error(err, "--session-cluster-role needs the manager's ServiceAccount")
			os.Exit(1)
		}
		access = &rbac.SessionAccess{Client: mgr.GetClient(), Reader: mgr.GetAPIReader(), ClusterRole: sessionClusterRole,
			ServiceAccount: saName, ServiceAccountNamespace: saNS}
		log.Info("session permissions", "clusterRole", sessionClusterRole, "serviceAccount", saNS+"/"+saName, "labNamespaceLabel", drivers.LabelLabNamespace+"=true")
	} else {
		log.Info("session permissions: not bound by the manager (--session-cluster-role empty)")
	}
	// Typed nil pointers must not reach the interfaces.
	var nsAccess drivers.NamespaceAccess
	var sessionAccess controller.SessionNamespaceAccess
	if access != nil {
		nsAccess, sessionAccess = access, access
	}
	rt, err := drivers.NewRuntime(drivers.RuntimeOptions{
		Client: mgr.GetClient(), Reader: mgr.GetAPIReader(), Scheme: scheme, Executor: executor,
		Catalog: catalog, ImageRegistry: registry, ImageMirrors: mirrors, ImagePullSecrets: pullSecrets,
		RuntimeClassName: runtimeClass, Sandboxes: sandboxes, AdminImageRef: adminImageRef,
		Helm: drivers.ExecHelm{Binary: helmBin}, VClusterChart: vclusterChart, VClusterValues: vclusterValues,
		VClusterPodSecurity: vclusterPodSecurity,
		PersistentHome:      persistentHome, VClusterPersistence: vclusterPersistence, StorageClass: storageClass, HomeStorageClass: homeStorageClass,
		VMDisks: drivers.VMDiskOptions{Persistent: vmDisks == "persistent", StorageClass: vmDiskStorageClass,
			VolumeMode: vmDiskVolumeMode, AccessModes: drivers.SplitList(vmDiskAccessModes)},
		UserNamespaces: useUserNS, DenyLearnerSudo: !allowLearnerSudo,
		Network: netOpts, NamespaceAccess: nsAccess,
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
	linkNet := &drivers.LinkNetwork{
		Manager:        &network.Manager{Client: mgr.GetClient()},
		Options:        netOpts,
		ToolsImage:     rt.Container.ImageFor(toolsImage),
		UserNamespaces: linkSysctls && useUserNS,
		LinkRateMbps:   linkRateMbps,
	}
	if linkRateMbps < 0 {
		log.Error(nil, "--link-rate-mbps must be >= 0", "value", linkRateMbps)
		os.Exit(1)
	}
	log.Info("wired lab pods", "userNamespace", linkNet.UserNamespaces, "writableNetSysctls", linkNet.UserNamespaces, "linkRateMbps", linkRateMbps)
	if ovnCentral != "" {
		ovn, err := drivers.ParseOVNCentral(ovnCentral)
		if err != nil {
			log.Error(err, "invalid --ovn-central")
			os.Exit(1)
		}
		ovn.Reader, ovn.Executor = mgr.GetAPIReader(), executor
		linkNet.OVN = ovn
	}
	rt.Container.Network = linkNet

	poolMetrics := controller.NewPoolMetrics()
	poolMetrics.Register()
	if err := (&controller.LabSessionReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Drivers: reg,
		Recorder:         mgr.GetEventRecorder("lab-orchestrator"),
		ProvisionTimeout: provisionTimeout, MaxConcurrentReconciles: concurrency,
		Session: rt.Session, Reader: mgr.GetAPIReader(), Metrics: poolMetrics, Access: sessionAccess,
		Sandboxes: sandboxes, Catalog: catalog,
	}).SetupWithManager(mgr); err != nil {
		log.Error(err, "unable to set up LabSession controller")
		os.Exit(1)
	}
	if err := (&controller.WarmPoolReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Recorder: mgr.GetEventRecorder("lab-orchestrator"),
		Metrics: poolMetrics,
	}).SetupWithManager(mgr); err != nil {
		log.Error(err, "unable to set up WarmPool controller")
		os.Exit(1)
	}
	if err := (&controller.ExamSessionReconciler{
		Client: mgr.GetClient(), Scheme: scheme, Drivers: reg,
		Recorder: mgr.GetEventRecorder("lab-orchestrator"), Access: sessionAccess,
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

// loadSandboxes merges the sandbox config file and the flags (--sandboxes
// overrides the file's tiers; the deprecated --tier-runtime-classes is
// exclusive with --sandboxes) and reads the optional preflight verdict.
// Nothing configured returns nil: sandboxes off, the default.
func loadSandboxes(flagValue, legacy, configPath, preflightPath string) (*drivers.Sandboxes, error) {
	if flagValue != "" && legacy != "" {
		return nil, fmt.Errorf("--sandboxes and the deprecated --tier-runtime-classes are exclusive")
	}
	tiers := map[string]drivers.SandboxTier{}
	b, err := drivers.LoadSandboxFile(configPath)
	if err != nil {
		return nil, err
	}
	if len(b) > 0 {
		c, err := drivers.ParseSandboxConfig(b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", configPath, err)
		}
		for t, v := range c.Tiers {
			tiers[t] = v
		}
	}
	parse, v := drivers.ParseSandboxFlag, flagValue
	if legacy != "" {
		parse, v = drivers.ParseTierRuntimeClasses, legacy
	}
	fl, err := parse(v)
	if err != nil {
		return nil, err
	}
	for t, v := range fl {
		tiers[t] = v
	}
	if len(tiers) == 0 {
		return nil, nil
	}
	sb := &drivers.Sandboxes{Tiers: tiers}
	if b, err = drivers.LoadSandboxFile(preflightPath); err != nil {
		return nil, err
	}
	if len(b) > 0 {
		if sb.Preflight, err = drivers.ParseSandboxPreflight(b); err != nil {
			return nil, fmt.Errorf("%s: %w", preflightPath, err)
		}
	}
	return sb, nil
}

// admissionPolicyServed reports whether the API server serves
// ValidatingAdmissionPolicy (admissionregistration.k8s.io/v1, Kubernetes
// 1.30+). Only a definite "not served" is false: the policy check then fails
// open with a warning; any other discovery error is checked by reading the
// policy.
func admissionPolicyServed(cfg *rest.Config) bool {
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return true
	}
	res, err := dc.ServerResourcesForGroupVersion("admissionregistration.k8s.io/v1")
	if err != nil {
		return !apierrors.IsNotFound(err)
	}
	for _, r := range res.APIResources {
		if r.Name == "validatingadmissionpolicies" {
			return true
		}
	}
	return false
}

// kubeVirtServed reports whether the API serves kubevirt.io/v1
// VirtualMachines (an error counts as served: the VM driver then reports it).
func kubeVirtServed(cfg *rest.Config) bool {
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return true
	}
	res, err := dc.ServerResourcesForGroupVersion("kubevirt.io/v1")
	if err != nil {
		return !apierrors.IsNotFound(err)
	}
	for _, r := range res.APIResources {
		if r.Name == "virtualmachines" {
			return true
		}
	}
	return false
}

// uncached: kinds the manager reads straight from the API server.
func uncached() []client.Object {
	return []client.Object{
		&corev1.Secret{}, &corev1.ConfigMap{}, &corev1.PersistentVolumeClaim{}, &corev1.ServiceAccount{},
		&corev1.Endpoints{}, &corev1.Namespace{}, &corev1.Node{}, &appsv1.StatefulSet{}, &appsv1.Deployment{},
		&networkingv1.NetworkPolicy{}, &rbacv1.Role{}, &rbacv1.RoleBinding{}, &rbacv1.ClusterRole{},
		&rbacv1.ClusterRoleBinding{}, &storagev1.StorageClass{}, &nodev1.RuntimeClass{},
	}
}

// ownServiceAccount parses --service-account (<namespace>/<name>), else
// $POD_NAMESPACE and $SERVICE_ACCOUNT_NAME.
func ownServiceAccount(flagValue string) (string, string, error) {
	if flagValue != "" {
		ns, name, ok := strings.Cut(flagValue, "/")
		if !ok || ns == "" || name == "" {
			return "", "", fmt.Errorf("--service-account %q: want <namespace>/<name>", flagValue)
		}
		return ns, name, nil
	}
	ns, name := os.Getenv("POD_NAMESPACE"), os.Getenv("SERVICE_ACCOUNT_NAME")
	if ns == "" || name == "" {
		return "", "", fmt.Errorf("set --service-account or POD_NAMESPACE and SERVICE_ACCOUNT_NAME")
	}
	return ns, name, nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
