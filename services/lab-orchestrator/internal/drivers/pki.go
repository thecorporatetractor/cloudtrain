package drivers

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// SSHKeyPair is an ed25519 key in OpenSSH formats.
type SSHKeyPair struct {
	// Private is the OpenSSH PEM private key.
	Private []byte
	// Public is the authorized_keys line ("ssh-ed25519 AAAA... comment").
	Public []byte
}

// NewSSHKeyPair generates an ed25519 key pair.
func NewSSHKeyPair(comment string) (SSHKeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return SSHKeyPair{}, err
	}
	blk, err := ssh.MarshalPrivateKey(priv, comment)
	if err != nil {
		return SSHKeyPair{}, err
	}
	sp, err := ssh.NewPublicKey(pub)
	if err != nil {
		return SSHKeyPair{}, err
	}
	line := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sp)))
	if comment != "" {
		line += " " + comment
	}
	return SSHKeyPair{Private: pem.EncodeToMemory(blk), Public: []byte(line + "\n")}, nil
}

// KnownHostsLine renders a known_hosts entry for a host public key
// (authorized_keys format, comment dropped).
func KnownHostsLine(hosts []string, pub []byte) string {
	f := strings.Fields(string(pub))
	if len(f) < 2 {
		return ""
	}
	return strings.Join(hosts, ",") + " " + f[0] + " " + f[1]
}

// CertKey is a PEM certificate and its PEM private key.
type CertKey struct {
	Cert []byte
	Key  []byte
}

func randomSerial() (*big.Int, error) {
	return rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
}

// NewCA creates a self-signed RSA CA, as kubeadm expects for an external
// "/etc/kubernetes/pki/ca.{crt,key}".
func NewCA(cn string, validity time.Duration) (CertKey, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return CertKey{}, err
	}
	serial, err := randomSerial()
	if err != nil {
		return CertKey{}, err
	}
	now := time.Now()
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(validity),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return CertKey{}, err
	}
	return CertKey{
		Cert: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		Key:  pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}),
	}, nil
}

func parseCA(ca CertKey) (*x509.Certificate, *rsa.PrivateKey, error) {
	cb, _ := pem.Decode(ca.Cert)
	kb, _ := pem.Decode(ca.Key)
	if cb == nil || kb == nil {
		return nil, nil, fmt.Errorf("invalid CA PEM")
	}
	cert, err := x509.ParseCertificate(cb.Bytes)
	if err != nil {
		return nil, nil, err
	}
	key, err := x509.ParsePKCS1PrivateKey(kb.Bytes)
	if err != nil {
		return nil, nil, err
	}
	return cert, key, nil
}

// NewClientCert issues a client certificate (CN = user, O = groups) from ca.
func NewClientCert(ca CertKey, cn string, groups []string, validity time.Duration) (CertKey, error) {
	caCert, caKey, err := parseCA(ca)
	if err != nil {
		return CertKey{}, err
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return CertKey{}, err
	}
	serial, err := randomSerial()
	if err != nil {
		return CertKey{}, err
	}
	now := time.Now()
	tpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: cn, Organization: groups},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(validity),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, caCert, &key.PublicKey, caKey)
	if err != nil {
		return CertKey{}, err
	}
	return CertKey{
		Cert: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		Key:  pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}),
	}, nil
}

// CAPublicKeyHash is kubeadm's discovery-token-ca-cert-hash ("sha256:<hex>").
func CAPublicKeyHash(caPEM []byte) (string, error) {
	b, _ := pem.Decode(caPEM)
	if b == nil {
		return "", fmt.Errorf("invalid CA PEM")
	}
	cert, err := x509.ParseCertificate(b.Bytes)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// NewBootstrapToken returns a kubeadm bootstrap token "[a-z0-9]{6}.[a-z0-9]{16}".
func NewBootstrapToken() (string, error) {
	b := make([]byte, 11)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	h := hex.EncodeToString(b) // 22 chars of [0-9a-f]
	return h[:6] + "." + h[6:22], nil
}

// ClientKubeconfig renders a single-context kubeconfig with embedded
// credentials. The context, cluster and user are all named after context.
func ClientKubeconfig(context, server string, caPEM []byte, client CertKey) ([]byte, error) {
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters[context] = &clientcmdapi.Cluster{Server: server, CertificateAuthorityData: caPEM}
	cfg.AuthInfos[context] = &clientcmdapi.AuthInfo{ClientCertificateData: client.Cert, ClientKeyData: client.Key}
	cfg.Contexts[context] = &clientcmdapi.Context{Cluster: context, AuthInfo: context}
	cfg.CurrentContext = context
	return clientcmd.Write(*cfg)
}

// RenameKubeconfig rewrites a kubeconfig to a single context named context
// (cluster and user renamed too), optionally pointing it at server.
func RenameKubeconfig(data []byte, context, server string) ([]byte, error) {
	in, err := clientcmd.Load(data)
	if err != nil {
		return nil, err
	}
	cur := in.CurrentContext
	if cur == "" {
		for k := range in.Contexts {
			cur = k
			break
		}
	}
	ctx, ok := in.Contexts[cur]
	if !ok {
		return nil, fmt.Errorf("kubeconfig has no context")
	}
	cl, ok := in.Clusters[ctx.Cluster]
	if !ok {
		return nil, fmt.Errorf("kubeconfig context %q has no cluster", cur)
	}
	ai, ok := in.AuthInfos[ctx.AuthInfo]
	if !ok {
		return nil, fmt.Errorf("kubeconfig context %q has no user", cur)
	}
	cl = cl.DeepCopy()
	if server != "" {
		cl.Server = server
	}
	out := clientcmdapi.NewConfig()
	out.Clusters[context] = cl
	out.AuthInfos[context] = ai.DeepCopy()
	out.Contexts[context] = &clientcmdapi.Context{Cluster: context, AuthInfo: context, Namespace: ctx.Namespace}
	out.CurrentContext = context
	return clientcmd.Write(*out)
}

// MergeKubeconfigs merges single-context kubeconfigs into one. The result
// has no current-context unless current names one of the contexts.
func MergeKubeconfigs(current string, configs ...[]byte) ([]byte, error) {
	out := clientcmdapi.NewConfig()
	for _, data := range configs {
		in, err := clientcmd.Load(data)
		if err != nil {
			return nil, err
		}
		for k, v := range in.Clusters {
			out.Clusters[k] = v
		}
		for k, v := range in.AuthInfos {
			out.AuthInfos[k] = v
		}
		for k, v := range in.Contexts {
			out.Contexts[k] = v
		}
	}
	if _, ok := out.Contexts[current]; ok {
		out.CurrentContext = current
	}
	return clientcmd.Write(*out)
}
