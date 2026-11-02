package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudtrain/cloudtrain/services/site-proxy/internal/limiter"
)

type upstream struct {
	mu       sync.Mutex
	calls    int
	lastPath string
	lastHdr  http.Header
	lastBody string
	status   int
	ctype    string
	body     string
	headers  map[string]string
	delay    time.Duration
}

func (u *upstream) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	u.mu.Lock()
	u.calls++
	u.lastPath, u.lastHdr = r.URL.Path, r.Header.Clone()
	b, _ := io.ReadAll(r.Body)
	u.lastBody = string(b)
	status, ctype, body, headers, delay := u.status, u.ctype, u.body, u.headers, u.delay
	u.mu.Unlock()
	if delay > 0 {
		time.Sleep(delay)
	}
	for k, v := range headers {
		w.Header().Set(k, v)
	}
	w.Header().Set("Content-Type", ctype)
	w.WriteHeader(status)
	io.WriteString(w, body)
}

type tokens struct {
	token       string
	err         error
	invalidated int
}

func (t *tokens) Token(context.Context) (string, error) { return t.token, t.err }
func (t *tokens) Invalidate()                           { t.invalidated++ }

type rig struct {
	h    *Handler
	up   *upstream
	tok  *tokens
	logs *bytes.Buffer
}

func newRig(t *testing.T, change func(*Options)) *rig {
	t.Helper()
	up := &upstream{status: 201, ctype: "application/json", body: `{"status":"created"}`}
	srv := httptest.NewServer(up)
	t.Cleanup(srv.Close)
	logs := &bytes.Buffer{}
	tok := &tokens{token: "the-token"}
	o := Options{
		FunctionURL:     srv.URL + "/",
		ClientIPHeader:  "CF-Connecting-IP",
		MaxBodyBytes:    1024,
		MaxInFlight:     4,
		UpstreamTimeout: 2 * time.Second,
		Limiter:         limiter.New(limiter.Config{PerKey: 60, Window: time.Hour, GlobalRate: 1e6, GlobalBurst: 1 << 20, MaxKeys: 100}, nil),
		Tokens:          tok,
		Logger:          slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}
	if change != nil {
		change(&o)
	}
	return &rig{h: New(o), up: up, tok: tok, logs: logs}
}

func (r *rig) post(path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", "203.0.113.7")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.h.ServeHTTP(w, req)
	return w
}

func TestForwardsTheThreeRoutesWithAFixedHeaderSet(t *testing.T) {
	r := newRig(t, nil)
	for _, p := range []string{"/api/public/waitlist", "/api/public/privacy/requests", "/api/public/privacy/confirm"} {
		w := r.post(p, `{"a":1}`, map[string]string{"Cookie": "x=y", "X-Evil": "1", "Authorization": "Bearer visitor", "X-Ms-Client-Principal-Id": "spoofed"})
		if w.Code != 201 || w.Body.String() != `{"status":"created"}` {
			t.Fatalf("%s: %d %s", p, w.Code, w.Body)
		}
		if r.up.lastPath != p || r.up.lastBody != `{"a":1}` {
			t.Fatalf("upstream saw %s %s", r.up.lastPath, r.up.lastBody)
		}
		h := r.up.lastHdr
		if h.Get("Authorization") != "Bearer the-token" {
			t.Fatalf("authorization: %q", h.Get("Authorization"))
		}
		if h.Get(ClientIPHeaderOut) != "203.0.113.7" {
			t.Fatalf("client ip: %q", h.Get(ClientIPHeaderOut))
		}
		for _, k := range []string{"Cookie", "X-Evil", "X-Ms-Client-Principal-Id", "Cf-Connecting-Ip"} {
			if h.Get(k) != "" {
				t.Fatalf("%s reached the function", k)
			}
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cache-control")
		}
	}
}

func TestEverythingElseIs404WithoutACall(t *testing.T) {
	r := newRig(t, nil)
	cases := []struct{ m, p string }{
		{"GET", "/api/public/privacy/confirm"},
		{"GET", "/api/public/waitlist"},
		{"GET", "/api/public/site"},
		{"POST", "/api/public/site"},
		{"POST", "/api/auth/login"},
		{"POST", "/api/public/waitlist/"},
		{"POST", "/api/public/waitlist/x"},
		{"OPTIONS", "/api/public/waitlist"},
		{"POST", "/"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.m, c.p, strings.NewReader("{}"))
		req.Header.Set("CF-Connecting-IP", "203.0.113.7")
		w := httptest.NewRecorder()
		r.h.ServeHTTP(w, req)
		if w.Code != 404 {
			t.Fatalf("%s %s: %d", c.m, c.p, w.Code)
		}
	}
	if r.up.calls != 0 {
		t.Fatalf("%d calls", r.up.calls)
	}
}

func TestPerAddressLimitAnswersInTheBrowserContract(t *testing.T) {
	r := newRig(t, func(o *Options) {
		o.Limiter = limiter.New(limiter.Config{PerKey: 2, Window: time.Hour, GlobalRate: 1e6, GlobalBurst: 1 << 20, MaxKeys: 100}, nil)
	})
	r.post("/api/public/waitlist", "{}", nil)
	r.post("/api/public/waitlist", "{}", nil)
	w := r.post("/api/public/waitlist", "{}", nil)
	if w.Code != 429 {
		t.Fatalf("%d", w.Code)
	}
	if r.up.calls != 2 {
		t.Fatalf("the function was called over the limit: %d", r.up.calls)
	}
	if ra := w.Header().Get("Retry-After"); ra == "" || ra == "0" {
		t.Fatalf("retry-after %q", ra)
	}
	var b struct {
		Code    string `json:"code"`
		Details struct {
			RetryAfterSeconds int `json:"retryAfterSeconds"`
		} `json:"details"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil || b.Code != "rate_limited" || b.Details.RetryAfterSeconds < 3590 {
		t.Fatalf("%s %v", w.Body, err)
	}
	if w := r.post("/api/public/waitlist", "{}", map[string]string{"CF-Connecting-IP": "203.0.113.8"}); w.Code != 201 {
		t.Fatalf("another visitor: %d", w.Code)
	}
}

func TestGlobalCapAcrossVisitors(t *testing.T) {
	r := newRig(t, func(o *Options) {
		o.Limiter = limiter.New(limiter.Config{PerKey: 60, Window: time.Hour, GlobalRate: 0.001, GlobalBurst: 2, MaxKeys: 100}, nil)
	})
	r.post("/api/public/waitlist", "{}", map[string]string{"CF-Connecting-IP": "203.0.113.1"})
	r.post("/api/public/waitlist", "{}", map[string]string{"CF-Connecting-IP": "203.0.113.2"})
	if w := r.post("/api/public/waitlist", "{}", map[string]string{"CF-Connecting-IP": "203.0.113.3"}); w.Code != 429 {
		t.Fatalf("%d", w.Code)
	}
	if r.up.calls != 2 {
		t.Fatalf("%d calls", r.up.calls)
	}
}

func TestClientIPHeaderRules(t *testing.T) {
	r := newRig(t, nil)
	for _, bad := range []string{"", "not-an-ip", "203.0.113.7, 198.51.100.1"} {
		req := httptest.NewRequest(http.MethodPost, "/api/public/waitlist", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		if bad != "" {
			req.Header.Set("CF-Connecting-IP", bad)
		}
		w := httptest.NewRecorder()
		r.h.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatalf("%q: %d", bad, w.Code)
		}
	}
	// Two copies of the header: which is the visitor's cannot be told.
	req := httptest.NewRequest(http.MethodPost, "/api/public/waitlist", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Add("CF-Connecting-IP", "203.0.113.1")
	req.Header.Add("CF-Connecting-IP", "203.0.113.2")
	w := httptest.NewRecorder()
	r.h.ServeHTTP(w, req)
	if w.Code != 400 || r.up.calls != 0 {
		t.Fatalf("%d, %d calls", w.Code, r.up.calls)
	}
}

func TestSocketAddressModeForLocalDevelopment(t *testing.T) {
	r := newRig(t, func(o *Options) { o.ClientIPHeader = "" })
	req := httptest.NewRequest(http.MethodPost, "/api/public/waitlist", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", "198.51.100.200") // ignored in this mode
	req.RemoteAddr = "192.0.2.10:12345"
	w := httptest.NewRecorder()
	r.h.ServeHTTP(w, req)
	if w.Code != 201 || r.up.lastHdr.Get(ClientIPHeaderOut) != "192.0.2.10" {
		t.Fatalf("%d %q", w.Code, r.up.lastHdr.Get(ClientIPHeaderOut))
	}
}

func TestBodyLimit(t *testing.T) {
	r := newRig(t, nil)
	if w := r.post("/api/public/waitlist", strings.Repeat("x", 1025), nil); w.Code != 413 {
		t.Fatalf("%d", w.Code)
	}
	if w := r.post("/api/public/waitlist", strings.Repeat("x", 1024), nil); w.Code != 201 {
		t.Fatalf("at the limit: %d", w.Code)
	}
	if r.up.calls != 1 {
		t.Fatalf("%d calls", r.up.calls)
	}
}

func TestOnlyJSONIsForwarded(t *testing.T) {
	r := newRig(t, nil)
	if w := r.post("/api/public/waitlist", "a=1", map[string]string{"Content-Type": "application/x-www-form-urlencoded"}); w.Code != 415 {
		t.Fatalf("%d", w.Code)
	}
	if w := r.post("/api/public/waitlist", "{}", map[string]string{"Content-Type": "application/json; charset=utf-8"}); w.Code != 201 {
		t.Fatalf("%d", w.Code)
	}
}

func TestNoTokenMeans503AndNoCall(t *testing.T) {
	r := newRig(t, nil)
	r.tok.err = errors.New("imds: status 500")
	w := r.post("/api/public/waitlist", "{}", nil)
	if w.Code != 503 || r.up.calls != 0 {
		t.Fatalf("%d, %d calls", w.Code, r.up.calls)
	}
}

func TestPlatformRefusalInvalidatesTheToken(t *testing.T) {
	for _, status := range []int{401, 403} {
		r := newRig(t, nil)
		r.up.status, r.up.body = status, `{"error":"internal detail"}`
		w := r.post("/api/public/waitlist", "{}", nil)
		if w.Code != 503 || strings.Contains(w.Body.String(), "internal detail") {
			t.Fatalf("%d: %d %s", status, w.Code, w.Body)
		}
		if r.tok.invalidated != 1 {
			t.Fatal("the token must be dropped")
		}
	}
}

func TestPassesContractStatusesThrough(t *testing.T) {
	r := newRig(t, nil)
	for _, c := range []struct {
		status int
		body   string
	}{
		{200, `{"status":"duplicate"}`},
		{202, `{"status":"accepted","message":"m"}`},
		{410, `{"error":"gone","code":"invalid"}`},
		{422, `{"error":"x","code":"invalid","details":{"fields":{"email":"e"}}}`},
		{503, `{"error":"x","code":"upstream"}`},
	} {
		r.up.status, r.up.body = c.status, c.body
		w := r.post("/api/public/waitlist", "{}", nil)
		if w.Code != c.status || w.Body.String() != c.body {
			t.Fatalf("%d: %d %s", c.status, w.Code, w.Body)
		}
	}
	r.up.status, r.up.body, r.up.headers = 429, `{"code":"rate_limited","details":{"retryAfterSeconds":1}}`, map[string]string{"Retry-After": "1"}
	if w := r.post("/api/public/waitlist", "{}", nil); w.Code != 429 || w.Header().Get("Retry-After") != "1" {
		t.Fatalf("%d %q", w.Code, w.Header().Get("Retry-After"))
	}
}

func TestPlatformErrorPagesBecomeGeneric(t *testing.T) {
	r := newRig(t, nil)
	r.up.status, r.up.ctype, r.up.body = 502, "text/html", "<html>azure</html>"
	if w := r.post("/api/public/waitlist", "{}", nil); w.Code != 503 || strings.Contains(w.Body.String(), "azure") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	r.up.status, r.up.ctype, r.up.body = 500, "application/json", `{"stack":"secret"}`
	if w := r.post("/api/public/waitlist", "{}", nil); w.Code != 503 || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestUpstreamTimeout(t *testing.T) {
	r := newRig(t, func(o *Options) { o.UpstreamTimeout = 50 * time.Millisecond })
	r.up.delay = 300 * time.Millisecond
	if w := r.post("/api/public/waitlist", "{}", nil); w.Code != 503 {
		t.Fatalf("%d", w.Code)
	}
}

func TestInFlightBound(t *testing.T) {
	r := newRig(t, func(o *Options) { o.MaxInFlight = 1 })
	r.up.delay = 200 * time.Millisecond
	done := make(chan int)
	go func() { done <- r.post("/api/public/waitlist", "{}", nil).Code }()
	time.Sleep(50 * time.Millisecond)
	if w := r.post("/api/public/waitlist", "{}", nil); w.Code != 429 {
		t.Fatalf("%d", w.Code)
	}
	if c := <-done; c != 201 {
		t.Fatalf("%d", c)
	}
}

func TestLogsHoldNoBodiesEmailsTokensOrAddresses(t *testing.T) {
	r := newRig(t, nil)
	body := `{"email":"person@example.com","token":"v1.secret-link"}`
	r.up.status, r.up.body = 500, `{"email":"person@example.com"}`
	r.post("/api/public/waitlist", body, nil)
	r.up.status = 401
	r.post("/api/public/waitlist", body, nil)
	r.tok.err = errors.New("imds: status 500")
	r.post("/api/public/waitlist", body, nil)
	out := r.logs.String()
	if out == "" {
		t.Fatal("expected some log lines")
	}
	for _, leak := range []string{"person@example.com", "secret-link", "the-token", "203.0.113.7"} {
		if strings.Contains(out, leak) {
			t.Fatalf("log holds %q: %s", leak, out)
		}
	}
}

func TestHealth(t *testing.T) {
	r := newRig(t, nil)
	w := httptest.NewRecorder()
	r.h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if w.Code != 204 {
		t.Fatalf("%d", w.Code)
	}
}
