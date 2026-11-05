package drivers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"sigs.k8s.io/yaml"
)

func TestCloudInitGraderAccess(t *testing.T) {
	admin, _ := NewSSHKeyPair("admin")
	learner, _ := NewSSHKeyPair("learner")
	host, _ := NewSSHKeyPair("root@h")
	ud, err := cloudInit{Hostname: "h", LearnerPub: learner.Public, AdminPub: admin.Public, HostKey: host,
		Hosts: []PlannedHost{{Name: "h", IP: "192.168.100.10"}}}.Render()
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		WriteFiles []cloudInitFile `json:"write_files"`
	}
	if err := yaml.Unmarshal(ud, &doc); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, f := range doc.WriteFiles {
		files[f.Path] = f.Content
	}
	var global []string
	for _, l := range strings.Split(files[GraderDropIn], "\n") {
		if l != "" && !strings.HasPrefix(l, "#") {
			global = append(global, l)
		}
	}
	if strings.Join(global, "|") != "HostKey "+GraderHostKey+"|HostKey /etc/ssh/ssh_host_ed25519_key|Include "+GraderMatch {
		t.Errorf("drop-in must only pin the host key and include the Match file: %q", global)
	}
	if files[GraderHostKey] != string(host.Private) || files[GraderHostKey+".pub"] != strings.TrimSpace(string(host.Public))+"\n" {
		t.Error("the platform host key copy must be the pinned host key")
	}
	m := files[GraderMatch]
	for _, want := range []string{"Match User root Address " + EntryIP + "\n", "\tPermitRootLogin prohibit-password\n",
		"\tAuthorizedKeysFile " + GraderKeyFile + "\n", "\tAllowUsers root\n", "\tAuthenticationMethods publickey\n"} {
		if !strings.Contains(m, want) {
			t.Errorf("match block lacks %q:\n%s", want, m)
		}
	}
	// Nothing but the Match line may be global: the block must not change sshd -T.
	for _, l := range strings.Split(strings.TrimSpace(m), "\n") {
		if l != "" && !strings.HasPrefix(l, "#") && !strings.HasPrefix(l, "Match ") && !strings.HasPrefix(l, "\t") {
			t.Errorf("global line in the match file: %q", l)
		}
	}
	if got := files[GraderKeyFile]; got != strings.TrimSpace(string(admin.Public))+"\n" || strings.Contains(got, strings.TrimSpace(string(learner.Public))) {
		t.Errorf("grader keys = %q, want the admin key only", got)
	}
}

func TestHostAccessFailed(t *testing.T) {
	for _, tt := range []struct {
		res  ExecResult
		want bool
	}{
		{ExecResult{ExitCode: 255, Stderr: "root@192.168.100.10: Permission denied (publickey,gssapi-keyex,gssapi-with-mic).\n"}, true},
		{ExecResult{ExitCode: 255, Stderr: "ssh: connect to host 192.168.100.10 port 22: Connection refused"}, true},
		{ExecResult{ExitCode: 255, Stderr: "kex_exchange_identification: read: Connection reset by peer"}, true},
		{ExecResult{ExitCode: 255, Stderr: "Connection closed by 192.168.100.10 port 22"}, true},
		{ExecResult{ExitCode: 255, Stderr: "@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.\n"}, true},
		{ExecResult{ExitCode: 255, Stderr: "Unable to negotiate with 192.168.100.10 port 22: no matching cipher found."}, true},
		{ExecResult{ExitCode: 255}, true}, // peer closed after the banner
		// the command ran: output, other exit codes, or its own last error line
		{ExecResult{ExitCode: 255, Stdout: "refused\n", Stderr: "root@127.0.0.1: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 1, Stderr: "root@192.168.100.10: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 255, Stderr: "learner@127.0.0.1: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 255, Stderr: "root@127.0.0.1: Permission denied (publickey).\nprobe finished"}, false},
	} {
		if got := hostAccessFailed(tt.res); got != tt.want {
			t.Errorf("hostAccessFailed(%+v) = %v, want %v", tt.res, got, tt.want)
		}
	}
}

// grading-3: a VM makes loginuids immutable on every boot, so root cannot move
// a process out of the learner's login session by rewriting its loginuid. A
// failure is reported, never fatal to the boot (cloud-init would end in
// status error and the node would never be Ready).
func TestCloudInitLoginuidImmutable(t *testing.T) {
	kp, _ := NewSSHKeyPair("k")
	ud, err := cloudInit{Hostname: "h", LearnerPub: kp.Public, AdminPub: kp.Public, HostKey: kp}.Render()
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		BootCmd [][]string `json:"bootcmd"`
		RunCmd  [][]string `json:"runcmd"`
	}
	if err := yaml.Unmarshal(ud, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.BootCmd) != 1 || len(doc.BootCmd[0]) != 3 || doc.BootCmd[0][2] != LoginuidImmutable {
		t.Fatalf("bootcmd must run the loginuid lock on every boot: %v", doc.BootCmd)
	}
	for _, c := range doc.RunCmd {
		if strings.Contains(strings.Join(c, " "), "loginuid") {
			t.Errorf("loginuid lock in runcmd (runs once per instance, not after a reboot): %v", c)
		}
	}
	for _, want := range []string{
		"A=/usr/sbin/auditctl",
		`"$A" --loginuid-immutable`,
		"echo 4294967295 > /proc/self/loginuid",
		"/run/cloudtrain/loginuid-lock",
		"/var/log/cloudtrain-loginuid.log",
		"logger -p auth.warning -t cloudtrain-loginuid",
	} {
		if !strings.Contains(LoginuidImmutable, want) {
			t.Errorf("LoginuidImmutable lacks %q", want)
		}
	}
	if !strings.HasSuffix(LoginuidImmutable, "\nexit 0") {
		t.Errorf("LoginuidImmutable must always exit 0 (a failing bootcmd fails cloud-init)")
	}
}

// The lock script itself, with a fake auditctl and a fake loginuid file: it
// trusts only whether the loginuid can still be changed, never stops the
// boot and records why it failed.
func TestLoginuidImmutableScript(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	const ok, refuse = "#!/bin/sh\nexit 0\n", "#!/bin/sh\necho 'Operation not permitted' >&2; exit 1\n"
	cases := []struct {
		name, auditctl, loginuid, wantState string
	}{
		// A directory cannot be written: what a locked loginuid does (EPERM).
		{"locked", ok, "dir", "locked"},
		{"refused", refuse, "dir", "failed: auditctl --loginuid-immutable failed: Operation not permitted"},
		// auditctl claims success (e.g. a shim), but the loginuid can still be changed.
		{"lying auditctl", ok, "file", "failed: loginuid still mutable after auditctl"},
		{"unreadable", ok, "", "failed: state unreadable: no /proc/self/loginuid"},
		{"missing", "", "dir", "failed: AUDITCTL not installed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			bin := filepath.Join(root, "bin")
			if err := os.MkdirAll(bin, 0o755); err != nil {
				t.Fatal(err)
			}
			auditctl := filepath.Join(root, "sbin-auditctl")
			if c.auditctl != "" {
				if err := os.WriteFile(auditctl, []byte(c.auditctl), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			loginuid := filepath.Join(root, "loginuid")
			switch c.loginuid {
			case "dir":
				if err := os.Mkdir(loginuid, 0o755); err != nil {
					t.Fatal(err)
				}
			case "file":
				if err := os.WriteFile(loginuid, nil, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			for _, tool := range []string{"sh", "mkdir", "tee"} {
				p, err := exec.LookPath(tool)
				if err != nil {
					t.Skip("no " + tool)
				}
				if err := os.Symlink(p, filepath.Join(bin, tool)); err != nil {
					t.Fatal(err)
				}
			}
			// Paths of the real script, moved under root.
			script := strings.NewReplacer("/usr/sbin/auditctl", auditctl, "/proc/self/loginuid", loginuid,
				"/run/cloudtrain", root+"/run", "/var/log/", root+"/", "/dev/console", root+"/console").Replace(LoginuidImmutable)
			bash, _ := exec.LookPath("bash")
			cmd := exec.Command(bash, "-c", script)
			cmd.Env = []string{"PATH=" + bin}
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("script must exit 0: %v\n%s", err, out)
			}
			state, err := os.ReadFile(filepath.Join(root, "run", "loginuid-lock"))
			if err != nil {
				t.Fatal(err)
			}
			want := strings.ReplaceAll(c.wantState, "AUDITCTL", auditctl)
			want = strings.ReplaceAll(want, "/proc/self/loginuid", loginuid)
			if got := strings.TrimSpace(string(state)); got != want {
				t.Errorf("state %q, want %q", got, want)
			}
			logged, _ := os.ReadFile(filepath.Join(root, "cloudtrain-loginuid.log"))
			if (want == "locked") == strings.Contains(string(logged), "WARNING: loginuid lock failed") {
				t.Errorf("log %q for state %q", logged, want)
			}
		})
	}
}

// The image's unit runs the same script as the runtime's bootcmd.
func TestLoginuidImmutableMatchesImage(t *testing.T) {
	b, err := os.ReadFile("../../../../tools/images/scripts/guest-loginuid.sh")
	if err != nil {
		t.Fatal(err)
	}
	_, body, ok := strings.Cut(string(b), "<<'LOCK'\n#!/bin/sh\n")
	body, _, ok2 := strings.Cut(body, "\nLOCK\n")
	if !ok || !ok2 {
		t.Fatal("no LOCK heredoc in guest-loginuid.sh")
	}
	if body != LoginuidImmutable {
		t.Errorf("tools/images/scripts/guest-loginuid.sh and LoginuidImmutable differ:\n%s\n---\n%s", body, LoginuidImmutable)
	}
	if strings.Contains(LoginuidImmutable, "command -v") || strings.Count(LoginuidImmutable, "auditctl --loginuid-immutable") != 1 {
		t.Error("auditctl must be called by absolute path")
	}
}
