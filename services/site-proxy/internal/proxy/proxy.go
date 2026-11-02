// Package proxy is the sidecar's HTTP handler: exactly three public routes, the rate limit, a
// bearer token for the function, bounded bodies and nothing personal in the log.
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/cloudtrain/cloudtrain/services/site-proxy/internal/limiter"
)

// ClientIPHeaderOut carries the visitor's address to the function, which uses it for logging only.
const ClientIPHeaderOut = "X-Ct-Client-Ip"

// The browser contract: POST only, these paths only. Everything else is a 404.
var routes = map[string]bool{
	"/api/public/waitlist":         true,
	"/api/public/privacy/requests": true,
	"/api/public/privacy/confirm":  true,
}

const maxUpstreamBody = 64 << 10

// TokenSource gives the bearer token for the function. Nil means no token (local development).
type TokenSource interface {
	Token(ctx context.Context) (string, error)
	Invalidate()
}

// Allower is the rate limit.
type Allower interface {
	Allow(addr netip.Addr) limiter.Decision
}

// Options configures a Handler.
type Options struct {
	FunctionURL     string // origin of the public Function app, no trailing slash
	ClientIPHeader  string // the header holding the visitor's address; empty uses the socket address
	MaxBodyBytes    int64
	MaxInFlight     int
	UpstreamTimeout time.Duration
	Limiter         Allower
	Tokens          TokenSource
	HTTPClient      *http.Client
	Logger          *slog.Logger
}

// Handler is the sidecar.
type Handler struct {
	o        Options
	inFlight chan struct{}
}

// New builds the handler.
func New(o Options) *Handler {
	if o.HTTPClient == nil {
		o.HTTPClient = &http.Client{Transport: &http.Transport{
			Proxy:               nil,
			MaxIdleConns:        4,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     60 * time.Second,
			TLSHandshakeTimeout: 5 * time.Second,
		}}
	}
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	o.FunctionURL = strings.TrimRight(o.FunctionURL, "/")
	return &Handler{o: o, inFlight: make(chan struct{}, o.MaxInFlight)}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" && r.Method == http.MethodGet {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost || !routes[r.URL.Path] {
		writeError(w, http.StatusNotFound, "Not found", "not_found", 0)
		return
	}
	addr, ok := h.clientIP(r)
	if !ok {
		// In header mode the proxy in front always sets it; without it the limit has no key.
		writeError(w, http.StatusBadRequest, "Bad request", "", 0)
		return
	}
	if d := h.o.Limiter.Allow(addr); !d.Allowed {
		h.o.Logger.Debug("rate limited", "scope", string(d.Scope))
		writeError(w, http.StatusTooManyRequests, "Too many requests, try again later", "rate_limited", d.RetryAfter)
		return
	}
	if !isJSON(r.Header.Get("Content-Type")) {
		writeError(w, http.StatusUnsupportedMediaType, "Expected JSON", "invalid", 0)
		return
	}
	select {
	case h.inFlight <- struct{}{}:
		defer func() { <-h.inFlight }()
	default:
		writeError(w, http.StatusTooManyRequests, "Too many requests, try again later", "rate_limited", time.Second)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, h.o.MaxBodyBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "Request too large", "invalid", 0)
			return
		}
		writeError(w, http.StatusBadRequest, "Bad request", "", 0)
		return
	}
	h.forward(w, r, addr, body)
}

func (h *Handler) forward(w http.ResponseWriter, r *http.Request, addr netip.Addr, body []byte) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), h.o.UpstreamTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.o.FunctionURL+r.URL.Path, bytes.NewReader(body))
	if err != nil {
		h.unavailable(w, r.URL.Path, "bad_upstream_url", 0, start)
		return
	}
	// A fixed set of headers: nothing else of the visitor's request reaches the function.
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set(ClientIPHeaderOut, addr.String())
	if h.o.Tokens != nil {
		token, err := h.o.Tokens.Token(ctx)
		if err != nil {
			// The error holds a status at most, never a token.
			h.o.Logger.Warn("no token for the function", "err", err.Error())
			h.unavailable(w, r.URL.Path, "token", 0, start)
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}

	res, err := h.o.HTTPClient.Do(req)
	if err != nil {
		h.unavailable(w, r.URL.Path, "upstream_unreachable", 0, start)
		return
	}
	defer res.Body.Close()

	// The platform refused the sidecar: a configuration problem, not the visitor's.
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		if h.o.Tokens != nil {
			h.o.Tokens.Invalidate()
		}
		h.unavailable(w, r.URL.Path, "upstream_refused", res.StatusCode, start)
		return
	}
	out, err := io.ReadAll(io.LimitReader(res.Body, maxUpstreamBody+1))
	if err != nil || len(out) > maxUpstreamBody {
		h.unavailable(w, r.URL.Path, "upstream_body", res.StatusCode, start)
		return
	}
	// The browser only reads JSON. An error page from the platform becomes the generic answer.
	if !isJSON(res.Header.Get("Content-Type")) {
		h.unavailable(w, r.URL.Path, "upstream_not_json", res.StatusCode, start)
		return
	}
	if res.StatusCode >= 500 && res.StatusCode != http.StatusServiceUnavailable {
		h.unavailable(w, r.URL.Path, "upstream_error", res.StatusCode, start)
		return
	}
	if v := res.Header.Get("Retry-After"); v != "" {
		w.Header().Set("Retry-After", v)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(res.StatusCode)
	_, _ = w.Write(out)
	if res.StatusCode >= 500 {
		h.o.Logger.Warn("request failed", "route", r.URL.Path, "status", res.StatusCode, "ms", time.Since(start).Milliseconds())
	}
}

func (h *Handler) unavailable(w http.ResponseWriter, route, reason string, upstream int, start time.Time) {
	h.o.Logger.Warn("request failed", "route", route, "reason", reason, "upstream", upstream, "ms", time.Since(start).Milliseconds())
	writeError(w, http.StatusServiceUnavailable, "Not available right now, try again in a few minutes", "upstream", 0)
}

func (h *Handler) clientIP(r *http.Request) (netip.Addr, bool) {
	if h.o.ClientIPHeader != "" {
		values := r.Header.Values(h.o.ClientIPHeader)
		if len(values) != 1 {
			return netip.Addr{}, false
		}
		a, err := netip.ParseAddr(strings.TrimSpace(values[0]))
		if err != nil {
			return netip.Addr{}, false
		}
		return a.Unmap().WithZone(""), true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}, false
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap().WithZone(""), true
}

func isJSON(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType)
	return err == nil && mt == "application/json"
}

// writeError answers in the gateway's ApiError shape, which the browser code reads.
func writeError(w http.ResponseWriter, status int, message, code string, retryAfter time.Duration) {
	body := map[string]any{"error": message}
	if code != "" {
		body["code"] = code
	}
	if retryAfter > 0 {
		secs := int64(math.Ceil(retryAfter.Seconds()))
		w.Header().Set("Retry-After", fmt.Sprint(secs))
		body["details"] = map[string]any{"retryAfterSeconds": secs}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
