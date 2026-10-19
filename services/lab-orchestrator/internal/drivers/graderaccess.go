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
// authorized_keys). Apart from HostKey (below) it changes nothing: `sshd -T` (the global,
// effective configuration that checks grade) is unaffected, a root login
// from anywhere else (127.0.0.1 probes, other hosts) or with any other key
// still follows the learner's policy.
//
// The Match block sits in its own file under /etc/ssh/cloudtrain, reached
// through an Include from a drop-in that sorts before the usual NN-name.conf
// ones ("0-" < "00-"), because in the per-connection pass the first Match
// value wins: sshd ends a Match block
// at the end of the file it is in (OpenSSH 9.6 and 9.9 tested), so the block
// cannot swallow lines that learners append to sshd_config or to other
// drop-ins, and compliance scanners and their remediation scripts (which
// read and rewrite sshd_config and sshd_config.d/*.conf) do not see or
// delete the root exception.
//
// The drop-in also pins the host key: a platform copy of the default ed25519
// key under /etc/ssh/cloudtrain, listed first, then the default path (both
// the key the session's known_hosts pins). Labs that remove /etc/ssh/ssh_host_* (golden-image prep) otherwise
// make sshd reset every new connection; the copy keeps the same identity. It
// is the only global setting: HostKey lists only ed25519, so the RSA/ECDSA keys
// an EL image generates are no longer offered (nothing pins them).
const (
	GraderDropIn  = "/etc/ssh/sshd_config.d/0-cloudtrain-grader.conf"
	GraderMatch   = "/etc/ssh/cloudtrain/grader.conf"
	GraderKeyFile = "/etc/ssh/cloudtrain/grader_keys"
	GraderHostKey = "/etc/ssh/cloudtrain/ssh_host_ed25519_key"
)

const graderDropIn = `# CloudTrain platform management access. Keep this file and ` + GraderMatch + `:
# the platform grades this host by logging in as root from the lab workstation
# (` + EntryIP + `) with its own key, and only that login is exempt from this host's
# sshd policy. Removing them locks the grader out and every check fails.
# The first HostKey is a platform copy of this host's ed25519 key (sshd serves
# the first key of a type), so the host keeps its pinned SSH identity when
# /etc/ssh/ssh_host_* are removed or regenerated.
HostKey ` + GraderHostKey + `
HostKey /etc/ssh/ssh_host_ed25519_key
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
func graderAccessFiles(adminPub []byte, hostKey SSHKeyPair) []cloudInitFile {
	return []cloudInitFile{
		{Path: GraderHostKey, Content: string(hostKey.Private), Permissions: "0600"},
		{Path: GraderHostKey + ".pub", Content: strings.TrimSpace(string(hostKey.Public)) + "\n", Permissions: "0644"},
		{Path: GraderDropIn, Content: graderDropIn, Permissions: "0644"},
		{Path: GraderMatch, Content: graderMatch, Permissions: "0644"},
		{Path: GraderKeyFile, Content: strings.TrimSpace(string(adminPub)) + "\n", Permissions: "0644"},
	}
}

// sshTransportFailure matches the last stderr line ssh prints when it cannot
// log in or connect at all (LogLevel ERROR, see sshConfig; a changed host key
// prints a multi-line warning that ends with "Host key verification failed.").
var sshTransportFailure = regexp.MustCompile(`^(root@\S+: Permission denied \(.*\)\.?|ssh: connect to host \S+ port \d+: .+|kex_exchange_identification: .+|Connection (closed|reset) by \S+ port \d+.*|Host key verification failed\.|Unable to negotiate with \S+ port \d+: .+)$`)

// hostAccessFailed reports whether an execOnHost result is ssh failing to
// log in to the host (exit 255, nothing on stdout, and ssh's own error as the
// last stderr line, or no stderr at all: a peer that closes after the banner)
// rather than the command's own result.
func hostAccessFailed(res ExecResult) bool {
	if res.ExitCode != 255 || strings.TrimSpace(res.Stdout) != "" {
		return false
	}
	errOut := strings.TrimSpace(res.Stderr)
	if errOut == "" {
		return true
	}
	lines := strings.Split(errOut, "\n")
	return sshTransportFailure.MatchString(strings.TrimSpace(lines[len(lines)-1]))
}
