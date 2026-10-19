package drivers

import (
	"strings"
	"testing"

	"sigs.k8s.io/yaml"
)

func TestCloudInitGraderAccess(t *testing.T) {
	admin, _ := NewSSHKeyPair("admin")
	learner, _ := NewSSHKeyPair("learner")
	ud, err := cloudInit{Hostname: "h", LearnerPub: learner.Public, AdminPub: admin.Public, HostKey: admin,
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
	if !strings.Contains(files[GraderDropIn], "Include "+GraderMatch+"\n") || strings.Contains(files[GraderDropIn], "Match") {
		t.Errorf("drop-in must only include the Match file: %q", files[GraderDropIn])
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
		// the command ran: output, other exit codes, or more than ssh's one line
		{ExecResult{ExitCode: 255, Stdout: "refused\n", Stderr: "root@127.0.0.1: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 1, Stderr: "root@192.168.100.10: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 255, Stderr: "probing\nroot@127.0.0.1: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 255, Stderr: "learner@127.0.0.1: Permission denied (publickey)."}, false},
		{ExecResult{ExitCode: 255}, false},
	} {
		if got := hostAccessFailed(tt.res); got != tt.want {
			t.Errorf("hostAccessFailed(%+v) = %v, want %v", tt.res, got, tt.want)
		}
	}
}
