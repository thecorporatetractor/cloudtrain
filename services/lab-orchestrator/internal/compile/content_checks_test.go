package compile

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The free-text reason check of xcd-ops-oom-diagnose (an exam task): correct
// diagnoses in the learner's own words pass, including ones that rule a cause
// out or mention context words; hedges and guess lists do not.
func TestOOMDiagnoseReasonPhrasings(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no sh")
	}
	const path = "../../../../content/packs/containers/labs/xcd-ops-oom-diagnose/lab.yaml"
	if _, err := os.Stat(path); err != nil {
		t.Skip("content packs not present")
	}
	lt, err := CompileFile(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var cmd string
	for _, c := range lt.Spec.Checks {
		if c.ID == "reason" {
			cmd = c.Command
		}
	}
	const file = "/home/learner/exam/import-reason.txt"
	if !strings.Contains(cmd, file) {
		t.Fatalf("reason check must read %s: %q", file, cmd)
	}
	dir := t.TempDir()
	reason := filepath.Join(dir, "import-reason.txt")
	run := func(content string) string {
		t.Helper()
		_ = os.Remove(reason)
		if content != "\x00" {
			if err := os.WriteFile(reason, []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		out, err := exec.Command("sh", "-c", strings.ReplaceAll(cmd, file, reason)).Output()
		if err != nil {
			t.Fatalf("%q: %v", content, err)
		}
		return strings.TrimSpace(string(out))
	}
	cases := map[string]string{
		// Accepted: the solution's wording and correct diagnoses in other words.
		"OOMKilled: memory limit (128m) exceeded, exit 137 = SIGKILL\n":                                     "named",
		"killed by the kernel OOM killer (memory limit)\n":                                                  "named",
		"It was not a crash: the kernel OOM killer stopped it at the memory limit\n":                        "named",
		"The memory limit in the run config is too low, so the kernel OOM killer killed it\n":               "named",
		"Exit 137 = SIGKILL from the OOM killer; the --memory limit is too small for the database import\n": "named",
		"OOM killed, memory or swap limit too low\n":                                                        "named",
		"Container ran out of RAM and was killed by the kernel\n":                                           "named",
		"out of memory":                  "named",
		"it exceeded its memory limit\n": "named",
		// Refused: not the cause, hedges, guess lists, more than one line, no file.
		"memory\n":                              "missing",
		"application crash\n":                   "missing",
		"exit code 137\n":                       "missing",
		"OOM or CPU throttling or bad config\n": "hedged",
		"maybe OOM\n":                           "hedged",
		"OOM?\n":                                "hedged",
		"crash or out of memory\n":              "hedged",
		"OOM killed\nor a crash\n":              "missing",
		// Guess lists without " or " (content-7): any competing cause that is not ruled out.
		"OOM, CPU throttling, bad config\n":                    "hedged",
		"OOM/CPU\n":                                            "hedged",
		"OOM CPU disk network crash\n":                         "hedged",
		"OOMKilled; also could be a crash; a bug; a timeout\n": "hedged",
		"OOM kill, alternatively a segfault\n":                 "hedged",
		"OOM killer; otherwise CPU\n":                          "hedged",
		"OOM bug\n":                                            "hedged",
		"out of memory or a segfault\n":                        "hedged",
		// Ruled-out causes stay fine.
		"OOM killed, not a crash and no timeout\n": "named",
		"memory limit hit rather than a bug\n":     "named",
		"OOM kill, wasn't a segfault\n":            "named",
		"the debug build hit its memory limit\n":   "named",
		// content-7 (loop 4): negated OOM terms and guess lists whose other causes are not
		// in the fixed word list are refused too.
		"not out of memory\n":                                                     "hedged",
		"no OOM, the container exited normally\n":                                 "hedged",
		"the memory limit was not reached; the app was killed by a user\n":        "hedged",
		"the memory limit wasn't reached\n":                                       "hedged",
		"it did not run out of memory\n":                                          "hedged",
		"OOM or something else\n":                                                 "hedged",
		"OOMKilled or SIGKILL from docker stop\n":                                 "hedged",
		"OOM or exception or panic or healthcheck failure\n":                      "hedged",
		"OOM / app error / host reboot\n":                                         "hedged",
		"OOM, exception, panic\n":                                                 "hedged",
		"OOM killed; the host lost power\n":                                       "hedged",
		"OOM & stopped by hand\n":                                                 "hedged",
		"OOM killer, either that or a deadlock\n":                                 "hedged",
		"memory limit hit, app error\n":                                           "hedged",
		"memory/swap limit too low, kernel OOM killer stopped it\n":               "named",
		"exit 137: SIGKILL from the kernel, the container hit its memory limit\n": "named",
		"\x00": "missing",
	}
	for in, want := range cases {
		if got := run(in); got != want {
			t.Errorf("%q: got %s, want %s", in, got, want)
		}
	}
}

// The shared answer parser of net-read-routing-table: headers and comments
// are ignored, a destination left out costs only its own check, and a
// destination answered more than once (a shotgun list) fails every check
// with a message that says which one.
func TestRoutingTableAnswerParser(t *testing.T) {
	if _, err := exec.LookPath("awk"); err != nil {
		t.Skip("no awk")
	}
	const path = "../../../../content/packs/networking/labs/net-read-routing-table/lab.yaml"
	if _, err := os.Stat(path); err != nil {
		t.Skip("content packs not present")
	}
	lt, err := CompileFile(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var cmd string
	for _, c := range lt.Spec.Checks {
		if c.ID == "ospf-route" {
			cmd = c.Command
		}
	}
	const file = "/home/learner/routes.txt"
	if !strings.Contains(cmd, file) {
		t.Fatalf("ospf-route must read %s: %q", file, cmd)
	}
	routes := filepath.Join(t.TempDir(), "routes.txt")
	run := func(content string) string {
		t.Helper()
		if err := os.WriteFile(routes, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		out, err := exec.Command("sh", "-c", strings.ReplaceAll(cmd, file, routes)).Output()
		if err != nil {
			t.Fatalf("%q: %v", content, err)
		}
		return string(out)
	}
	five := "10.30.20.5 OSPF 10.30.0.2\n10.30.30.7 static 10.30.0.6\n10.30.20.9 static 10.30.0.6\n10.30.40.7 ospf 10.30.0.2\n198.51.100.5 static 10.30.0.10\n"
	for name, tc := range map[string]struct{ in, want string }{
		"five answers":               {five, strings.Replace(five, "OSPF", "ospf", 1)},
		"header and comment ignored": {"destination protocol next-hop\n# my answers\n\n" + five, strings.Replace(five, "OSPF", "ospf", 1)},
		"one left out":               {"10.30.20.5 ospf 10.30.0.2\n198.51.100.5 static 10.30.0.10\n", "10.30.20.5 ospf 10.30.0.2\n198.51.100.5 static 10.30.0.10\n"},
		"shotgun":                    {five + "10.30.20.9 ospf 10.30.0.2\n", "destination 10.30.20.9 has more than one line: write one route per destination\n"},
	} {
		if got := run(tc.in); got != tc.want {
			t.Errorf("%s: got %q, want %q", name, got, tc.want)
		}
	}
}
