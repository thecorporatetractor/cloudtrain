package drivers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// kubeApplyScript retries while the namespace's default ServiceAccount is
// missing, passes the manifest on every attempt and keeps other failures.
func TestKubeApplyScriptRetriesMissingServiceAccount(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no sh")
	}
	dir := t.TempDir()
	fake := filepath.Join(dir, "kubectl")
	// Fails twice with the ServiceAccount error, then echoes the manifest.
	script := `#!/bin/sh
n=$(cat "` + dir + `/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "` + dir + `/n"
[ "$1" = apply ] && [ "$2" = -f ] || { echo "bad args $*" >&2; exit 2; }
if [ $n -le 2 ]; then echo 'Error from server (Forbidden): pods "p" is forbidden: error looking up service account x/default: serviceaccount "default" not found' >&2; exit 1; fi
cat "$3"
`
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", "-c", strings.Replace(kubeApplyScript, "sleep 2", "sleep 0", 1), "sh", fake, "apply")
	cmd.Stdin = strings.NewReader("kind: Pod\n")
	out, err := cmd.Output()
	if err != nil || string(out) != "kind: Pod\n" {
		t.Fatalf("out %q err %v", out, err)
	}
	if n, _ := os.ReadFile(filepath.Join(dir, "n")); strings.TrimSpace(string(n)) != "3" {
		t.Errorf("attempts %q, want 3", n)
	}

	// Any other error is returned at once with kubectl's stderr and exit code.
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho 'error: invalid' >&2\nexit 7\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd = exec.Command("sh", "-c", kubeApplyScript, "sh", fake, "apply")
	cmd.Stdin = strings.NewReader("kind: Pod\n")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 7 || !strings.Contains(stderr.String(), "error: invalid") {
		t.Errorf("err %v stderr %q", err, stderr.String())
	}
}
