package drivers

import (
	"context"
	"fmt"
	"strings"

	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// defaultClassAnnotations mark a StorageClass as the cluster default.
var defaultClassAnnotations = []string{
	"storageclass.kubernetes.io/is-default-class",
	"storageclass.beta.kubernetes.io/is-default-class",
}

// ValidVolumeMode reports whether m is a usable --vm-disk-volume-mode.
func ValidVolumeMode(m string) bool { return m == "" || m == "Block" || m == "Filesystem" }

// ValidAccessModes reports whether every mode is a PVC access mode.
func ValidAccessModes(modes []string) bool {
	for _, m := range modes {
		switch m {
		case "ReadWriteOnce", "ReadWriteMany", "ReadOnlyMany", "ReadWriteOncePod":
		default:
			return false
		}
	}
	return true
}

// SplitList splits a comma separated flag value, dropping blanks.
func SplitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// StorageFinding is one result of CheckStorage.
type StorageFinding struct {
	// Fatal findings name a configured class that does not exist; the others
	// are warnings.
	Fatal   bool
	Message string
}

// CheckStorage verifies the StorageClasses the platform will use. Each entry
// of configured maps a purpose (e.g. "vm disks") to the class named for it
// ("" = cluster default). A named class must exist (fatal); a purpose that
// relies on the default is warned about when the cluster has no default.
// Without permission to list StorageClasses it only warns.
func CheckStorage(ctx context.Context, r client.Reader, configured map[string]string) []StorageFinding {
	list := &storagev1.StorageClassList{}
	if err := r.List(ctx, list); err != nil {
		if apierrors.IsForbidden(err) {
			return []StorageFinding{{Message: "cannot list StorageClasses (RBAC); storage preflight skipped"}}
		}
		return []StorageFinding{{Message: fmt.Sprintf("cannot list StorageClasses: %v; storage preflight skipped", err)}}
	}
	names := map[string]bool{}
	hasDefault := false
	for _, sc := range list.Items {
		names[sc.Name] = true
		for _, a := range defaultClassAnnotations {
			if sc.Annotations[a] == "true" {
				hasDefault = true
			}
		}
	}
	var out []StorageFinding
	for _, purpose := range sortedKeys(configured) {
		class := configured[purpose]
		switch {
		case class != "" && !names[class]:
			out = append(out, StorageFinding{Fatal: true, Message: fmt.Sprintf("StorageClass %q configured for %s does not exist", class, purpose)})
		case class == "" && !hasDefault:
			out = append(out, StorageFinding{Message: fmt.Sprintf("no StorageClass is configured for %s and the cluster has no default class: PVCs will stay Pending (set --storage-class or mark a class default)", purpose)})
		}
	}
	return out
}
