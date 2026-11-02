// Package imds gets Entra tokens for the VM's user-assigned managed identity from the Azure
// Instance Metadata Service, and caches them until near expiry. The VM has no other credential.
package imds

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// DefaultEndpoint is the fixed address of IMDS on every Azure VM.
const DefaultEndpoint = "http://169.254.169.254/metadata/identity/oauth2/token"

const (
	apiVersion = "2018-02-01"
	// A token is replaced this long before it expires, so a request never carries one about to lapse.
	refreshMargin = 5 * time.Minute
	// After a failure nothing asks IMDS for this long: it rate-limits per VM, and a flood of
	// visitors must not turn into a flood of token requests.
	failureHold = 5 * time.Second
	attempts    = 3
)

// Config selects the token. ClientID is explicit: a VM can hold several identities.
type Config struct {
	Endpoint string // DefaultEndpoint when empty
	Resource string // the audience of the function's Entra app registration
	ClientID string // client id of the user-assigned identity
}

// Client is safe for concurrent use; concurrent callers share one fetch.
type Client struct {
	cfg  Config
	http *http.Client
	now  func() time.Time
	wait func(time.Duration)

	mu       sync.Mutex
	token    string
	expires  time.Time
	failedAt time.Time
	lastErr  error
}

// New builds a client. The transport ignores proxy settings: IMDS refuses proxied requests.
func New(cfg Config) (*Client, error) {
	if cfg.Resource == "" || cfg.ClientID == "" {
		return nil, errors.New("imds: resource and client id are required")
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	return &Client{
		cfg:  cfg,
		http: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}},
		now:  time.Now,
		wait: time.Sleep,
	}, nil
}

// Token answers the cached token, or fetches a new one. Near expiry, a failed refresh falls back
// to the old token while it is still valid.
func (c *Client) Token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.token != "" && now.Before(c.expires.Add(-refreshMargin)) {
		return c.token, nil
	}
	stillValid := c.token != "" && now.Before(c.expires)
	if !c.failedAt.IsZero() && now.Sub(c.failedAt) < failureHold {
		if stillValid {
			return c.token, nil
		}
		return "", c.lastErr
	}
	token, expires, err := c.fetch(ctx)
	if err != nil {
		c.failedAt, c.lastErr = c.now(), err
		if stillValid {
			return c.token, nil
		}
		return "", err
	}
	c.token, c.expires, c.failedAt, c.lastErr = token, expires, time.Time{}, nil
	return token, nil
}

// Invalidate drops the cached token: the function refused it, so the next request fetches again.
func (c *Client) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token, c.expires = "", time.Time{}
}

func (c *Client) fetch(ctx context.Context) (string, time.Time, error) {
	var last error
	for attempt := range attempts {
		if attempt > 0 {
			c.wait(time.Duration(attempt) * 500 * time.Millisecond)
		}
		token, expires, retry, err := c.once(ctx)
		if err == nil {
			return token, expires, nil
		}
		last = err
		if !retry {
			break
		}
	}
	return "", time.Time{}, last
}

func (c *Client) once(ctx context.Context) (token string, expires time.Time, retry bool, err error) {
	q := url.Values{"api-version": {apiVersion}, "resource": {c.cfg.Resource}, "client_id": {c.cfg.ClientID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.Endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return "", time.Time{}, false, err
	}
	req.Header.Set("Metadata", "true")
	res, err := c.http.Do(req)
	if err != nil {
		return "", time.Time{}, true, fmt.Errorf("imds: request failed: %w", unwrapURLError(err))
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return "", time.Time{}, true, fmt.Errorf("imds: reading the answer: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		// The answer's body is not repeated here: only the status goes to the log.
		retryable := res.StatusCode == http.StatusTooManyRequests || res.StatusCode == http.StatusGone || res.StatusCode >= 500
		return "", time.Time{}, retryable, fmt.Errorf("imds: status %d", res.StatusCode)
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresOn   string `json:"expires_on"`
		ExpiresIn   string `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", time.Time{}, false, errors.New("imds: the answer is not JSON")
	}
	if out.AccessToken == "" {
		return "", time.Time{}, false, errors.New("imds: the answer has no token")
	}
	if on, err := strconv.ParseInt(out.ExpiresOn, 10, 64); err == nil && on > 0 {
		return out.AccessToken, time.Unix(on, 0), false, nil
	}
	if in, err := strconv.ParseInt(out.ExpiresIn, 10, 64); err == nil && in > 0 {
		return out.AccessToken, c.now().Add(time.Duration(in) * time.Second), false, nil
	}
	return "", time.Time{}, false, errors.New("imds: the answer has no expiry")
}

// A url.Error repeats the whole URL; the cause is enough.
func unwrapURLError(err error) error {
	var u *url.Error
	if errors.As(err, &u) {
		return u.Err
	}
	return err
}
