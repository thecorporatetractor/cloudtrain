package drivers

import (
	"regexp"
	"strings"
)

// Grader (management) access to VM-backed hosts.
//
// Checks, setup steps and mutations run on a VM as root over ssh from the
// entry node's admin sidecar (execOnHost). Hardening labs make the learner
// turn off root logins, restrict AllowUsers/AllowGroups and so on, which
// would lock that path out. Every host therefore gets an sshd Match block
// that keeps exactly one login working whatever the learner's global
// policy says: root, from the entry node's address, with the platform's
// admin key (a key file only the platform writes, not root's
// authorized_keys). It changes nothing else: `sshd -T` (the global,
// effective configuration that checks grade) is unaffected, a root login
// from anywhere else (127.0.0.1 probes, other hosts) or with any other key
// still follows the learner's policy.
//
// The Match block sits in its own file under /etc/ssh/cloudtrain, reached
// through an Include from a drop-in that sorts first: sshd ends a Match block
// at the end of the file it is in (OpenSSH 9.6 and 9.9 tested), so the block
// cannot swallow lines that learners append to sshd_config or to other
// drop-ins, and compliance scanners and their remediation scripts (which
// read and rewrite sshd_config and sshd_config.d/*.conf) do not see or
// delete the root exception.
const (
	GraderDropIn  = "/etc/ssh/sshd_config.d/00-cloudtrain-grader.conf"
	GraderMatch   = "/etc/ssh/cloudtrain/grader.conf"
	GraderKeyFile = "/etc/ssh/cloudtrain/grader_keys"
)

const graderDropIn = `# CloudTrain platform management access. Keep this file and ` + GraderMatch + `:
# the platform grades this host by logging in as root from the lab workstation
# (` + EntryIP + `) with its own key, and only that login is exempt from this host's
# sshd policy. Removing them locks the grader out and every check fails.
Include ` + GraderMatch + `
`

// graderMatch overrides, for the grader's login only, every Match-able
// keyword a hardening task can use to refuse it. Ciphers, KEX, MACs and host
// key algorithms cannot be set in a Match block; the admin client negotiates
// any modern set. Only keywords whose "none" really unsets them: RevokedKeys
// none is read as a file named "none" and refuses every key.
const graderMatch = `# CloudTrain platform management access (see ` + GraderDropIn + `).
Match User root Address ` + EntryIP + `
	PermitRootLogin prohibit-password
	PubkeyAuthentication yes
	AuthenticationMethods publickey
	PubkeyAcceptedAlgorithms ssh-ed25519
	PubkeyAuthOptions none
	AuthorizedKeysFile ` + GraderKeyFile + `
	AuthorizedKeysCommand none
	AllowUsers root
	AllowGroups root
	DenyUsers ct-grader-none
	DenyGroups ct-grader-none
	ForceCommand none
	ChrootDirectory none
	MaxSessions 10
`

// graderAccessFiles are the cloud-init write_files entries for grader access.
func graderAccessFiles(adminPub []byte) []cloudInitFile {
	return []cloudInitFile{
		{Path: GraderDropIn, Content: graderDropIn, Permissions: "0644"},
		{Path: GraderMatch, Content: graderMatch, Permissions: "0644"},
		{Path: GraderKeyFile, Content: strings.TrimSpace(string(adminPub)) + "\n", Permissions: "0644"},
	}
}

// sshTransportFailure matches the single stderr line ssh prints when it
// cannot log in or connect at all (LogLevel ERROR, see sshConfig).
var sshTransportFailure = regexp.MustCompile(`^(root@\S+: Permission denied \(.*\)\.?|ssh: connect to host \S+ port \d+: .+|kex_exchange_identification: .+|Connection (closed|reset) by \S+ port \d+.*|Host key verification failed\.)$`)

// hostAccessFailed reports whether an execOnHost result is ssh failing to
// log in to the host (exit 255, nothing on stdout, only ssh's own error on
// stderr) rather than the command's own result.
func hostAccessFailed(res ExecResult) bool {
	if res.ExitCode != 255 || strings.TrimSpace(res.Stdout) != "" {
		return false
	}
	lines := strings.Split(strings.TrimSpace(res.Stderr), "\n")
	return len(lines) == 1 && sshTransportFailure.MatchString(strings.TrimSpace(lines[0]))
}
