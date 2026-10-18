package drivers

import (
	"fmt"
	"sort"
	"strings"
)

// RegistryMirror rewrites image refs under From to To, e.g.
// ghcr.io/acme/cloudtrain -> myregistry.azurecr.io/cloudtrain: a release
// catalog overlay names the signed GHCR images by digest, and a cluster that
// pulls from its own registry (ACR import, ECR pull-through cache, Artifact
// Registry remote repository, Harbor proxy cache) keeps the digests and only
// swaps the registry. From "docker.io" also matches unqualified refs
// (busybox:1.37 = docker.io/library/busybox:1.37).
type RegistryMirror struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// ParseRegistryMirrors parses "from=to,from2=to2" (the manager's
// --image-mirror flag). Both sides must be registry[/path] without a tag.
func ParseRegistryMirrors(s string) ([]RegistryMirror, error) {
	var out []RegistryMirror
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		from, to, ok := strings.Cut(part, "=")
		m := RegistryMirror{From: strings.TrimSpace(from), To: strings.TrimSpace(to)}
		if !ok {
			return nil, fmt.Errorf("image mirror %q: want from=to", part)
		}
		if err := m.validate(); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (m RegistryMirror) validate() error {
	for _, v := range []string{m.From, m.To} {
		v = strings.TrimSuffix(v, "/")
		if v == "" || strings.ContainsAny(v, "@ \t") || strings.Contains(v, "://") {
			return fmt.Errorf("image mirror %s=%s: both sides must be registry[/path] (no scheme, tag or digest)", m.From, m.To)
		}
		last := v[strings.LastIndex(v, "/")+1:]
		if strings.Contains(last, ":") && strings.Contains(v, "/") {
			return fmt.Errorf("image mirror %s=%s: both sides must be registry[/path] (no tag)", m.From, m.To)
		}
	}
	return nil
}

// qualified reports whether ref names its registry (first path component
// with a dot or port, or localhost).
func qualified(ref string) bool {
	first, _, hasSlash := strings.Cut(ref, "/")
	return hasSlash && (strings.ContainsAny(first, ".:") || first == "localhost")
}

// dockerHubName returns the docker.io form of an unqualified ref
// (busybox:1 -> docker.io/library/busybox:1, a/b -> docker.io/a/b).
func dockerHubName(ref string) string {
	if strings.Contains(ref, "/") {
		return "docker.io/" + ref
	}
	return "docker.io/library/" + ref
}

// ResolveImage turns a catalog image into the ref the cluster pulls:
// registry prefixes an unqualified image (as --image-registry always did),
// then the longest matching mirror rewrites its registry part. A mirror's
// From matches at a path boundary (a registry, a path, or a whole repository
// before its tag or digest); tags and digests are kept.
func ResolveImage(registry string, mirrors []RegistryMirror, image string) string {
	out := image
	if registry != "" && !qualified(out) {
		out = strings.TrimSuffix(registry, "/") + "/" + out
	}
	if len(mirrors) == 0 {
		return out
	}
	candidate := out
	if !qualified(candidate) {
		candidate = dockerHubName(candidate)
	}
	ms := append([]RegistryMirror(nil), mirrors...)
	sort.SliceStable(ms, func(i, j int) bool { return len(ms[i].From) > len(ms[j].From) })
	for _, m := range ms {
		from := strings.TrimSuffix(m.From, "/")
		if rest, ok := strings.CutPrefix(candidate, from); ok && (rest == "" || strings.ContainsAny(rest[:1], "/:@")) {
			return strings.TrimSuffix(m.To, "/") + rest
		}
	}
	return out
}

// Publishing -----------------------------------------------------------------

// PublishName is the name CI publishes an image under
// (ghcr.io/<owner>/<repo>/<name>): publishName, else the last path component
// of the image without tag or digest (cloudtrain/jumphost:1 -> jumphost).
func (img CatalogImage) PublishName() string {
	if img.PublishAs != "" {
		return img.PublishAs
	}
	name := img.Image
	if i := strings.Index(name, "@"); i >= 0 {
		name = name[:i]
	}
	name = name[strings.LastIndex(name, "/")+1:]
	if i := strings.Index(name, ":"); i >= 0 {
		name = name[:i]
	}
	return name
}

// ReleaseOverlay builds the catalog overlay of a release: every publishable
// entry whose PublishName has a digest is pointed at registry/name@digest.
// Entries that are not publishable are left out (they keep their catalog
// image, e.g. an upstream image or one built per site); publishable entries
// without a digest are returned in missing (not published by CI yet, e.g.
// containerDisks).
func ReleaseOverlay(c *ImageCatalog, registry string, digests map[string]string) (*ImageCatalog, []string, error) {
	registry = strings.TrimSuffix(registry, "/")
	if registry == "" {
		return nil, nil, fmt.Errorf("release overlay: no registry")
	}
	out := &ImageCatalog{APIVersion: c.APIVersion, Kind: "ImageCatalog", Images: map[string]CatalogImage{}}
	if out.APIVersion == "" {
		out.APIVersion = "cloudtrain.dev/v1"
	}
	var missing []string
	for ref, img := range c.Images {
		if !img.Publishable {
			continue
		}
		d, ok := digests[img.PublishName()]
		if !ok {
			missing = append(missing, ref)
			continue
		}
		if !strings.HasPrefix(d, "sha256:") || len(d) != len("sha256:")+64 {
			return nil, nil, fmt.Errorf("release overlay: %s: digest %q is not sha256:<64 hex>", img.PublishName(), d)
		}
		img.Image = registry + "/" + img.PublishName() + "@" + d
		out.Images[ref] = img
	}
	sort.Strings(missing)
	return out, missing, nil
}

// CheckPublished verifies the images a CI workflow publishes against the
// catalog files (each file on its own, not merged, so an overlay that swaps
// a ref for another image cannot hide the restricted original): every
// published name must belong to a publishable entry or be a platform image,
// and a name whose entries are all not publishable is an error. This keeps
// license-restricted images (the Terraform workstation, BUSL-1.1) out of
// public registries.
func CheckPublished(catalogs []*ImageCatalog, published, platform []string) []string {
	byName := map[string][]string{}
	restricted := map[string][]string{}
	for _, c := range catalogs {
		for ref, img := range c.Images {
			if img.Publishable {
				byName[img.PublishName()] = append(byName[img.PublishName()], ref)
			} else {
				restricted[img.PublishName()] = append(restricted[img.PublishName()], ref)
			}
		}
	}
	plat := map[string]bool{}
	for _, p := range platform {
		plat[strings.TrimSpace(p)] = true
	}
	var errs []string
	for _, name := range published {
		if plat[name] {
			continue
		}
		if len(byName[name]) > 0 {
			continue
		}
		if refs := restricted[name]; len(refs) > 0 {
			sort.Strings(refs)
			errs = append(errs, fmt.Sprintf("%s is published, but catalog %s is not publishable", name, strings.Join(refs, ", ")))
			continue
		}
		errs = append(errs, fmt.Sprintf("%s is published, but no publishable catalog entry has that name (set publishable: true and publishName)", name))
	}
	sort.Strings(errs)
	return errs
}
