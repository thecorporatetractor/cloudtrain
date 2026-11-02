package imds

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fake struct {
	calls  atomic.Int32
	status atomic.Int32
	expiry atomic.Int64
	last   atomic.Pointer[http.Request]
}

func newFake(t *testing.T) (*fake, *Client, *time.Time) {
	t.Helper()
	f := &fake{}
	now := time.Unix(1_800_000_000, 0)
	f.status.Store(200)
	f.expiry.Store(now.Add(time.Hour).Unix())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := f.calls.Add(1)
		f.last.Store(r)
		if s := int(f.status.Load()); s != 200 {
			w.WriteHeader(s)
			fmt.Fprint(w, `{"error":"secret-detail"}`)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": fmt.Sprintf("tok-%d", n), "expires_on": fmt.Sprint(f.expiry.Load()), "resource": "x", "token_type": "Bearer"})
	}))
	t.Cleanup(srv.Close)
	c, err := New(Config{Endpoint: srv.URL, Resource: "api://site-api", ClientID: "11111111-2222-3333-4444-555555555555"})
	if err != nil {
		t.Fatal(err)
	}
	c.now = func() time.Time { return now }
	c.wait = func(time.Duration) {}
	return f, c, &now
}

func TestRequestShape(t *testing.T) {
	f, c, _ := newFake(t)
	if _, err := c.Token(context.Background()); err != nil {
		t.Fatal(err)
	}
	r := f.last.Load()
	if r.Header.Get("Metadata") != "true" {
		t.Fatal("the Metadata header is required")
	}
	q := r.URL.Query()
	if q.Get("client_id") != "11111111-2222-3333-4444-555555555555" || q.Get("resource") != "api://site-api" || q.Get("api-version") != "2018-02-01" {
		t.Fatalf("query: %v", q)
	}
	if r.Header.Get("X-Forwarded-For") != "" {
		t.Fatal("IMDS refuses a request with X-Forwarded-For")
	}
}

func TestCachedUntilNearExpiry(t *testing.T) {
	f, c, now := newFake(t)
	ctx := context.Background()
	a, _ := c.Token(ctx)
	b, _ := c.Token(ctx)
	if a != b || f.calls.Load() != 1 {
		t.Fatalf("not cached: %q %q, %d calls", a, b, f.calls.Load())
	}
	*now = now.Add(54 * time.Minute)
	if x, _ := c.Token(ctx); x != a || f.calls.Load() != 1 {
		t.Fatalf("refreshed 6 minutes before expiry: %d calls", f.calls.Load())
	}
	*now = now.Add(2 * time.Minute) // 4 minutes before expiry
	f.expiry.Store(now.Add(time.Hour).Unix())
	if x, _ := c.Token(ctx); x == a || f.calls.Load() != 2 {
		t.Fatalf("should have refreshed: %q, %d calls", x, f.calls.Load())
	}
}

func TestConcurrentCallersShareOneFetch(t *testing.T) {
	f, c, _ := newFake(t)
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			if _, err := c.Token(context.Background()); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if f.calls.Load() != 1 {
		t.Fatalf("%d calls", f.calls.Load())
	}
}

func TestFailureHoldsOffAndHidesTheBody(t *testing.T) {
	f, c, now := newFake(t)
	f.status.Store(500)
	ctx := context.Background()
	_, err := c.Token(ctx)
	if err == nil || strings.Contains(err.Error(), "secret-detail") {
		t.Fatalf("error: %v", err)
	}
	if f.calls.Load() != attempts {
		t.Fatalf("%d attempts", f.calls.Load())
	}
	if _, err := c.Token(ctx); err == nil || f.calls.Load() != attempts {
		t.Fatalf("no hold-off after a failure: %d calls", f.calls.Load())
	}
	*now = now.Add(failureHold + time.Second)
	f.status.Store(200)
	if _, err := c.Token(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestPermanentErrorIsNotRetried(t *testing.T) {
	f, c, _ := newFake(t)
	f.status.Store(400) // identity not assigned to this VM
	if _, err := c.Token(context.Background()); err == nil {
		t.Fatal("want an error")
	}
	if f.calls.Load() != 1 {
		t.Fatalf("%d attempts", f.calls.Load())
	}
}

func TestOldTokenServesWhileRefreshFails(t *testing.T) {
	f, c, now := newFake(t)
	ctx := context.Background()
	a, _ := c.Token(ctx)
	*now = now.Add(58 * time.Minute)
	f.status.Store(503)
	if x, err := c.Token(ctx); err != nil || x != a {
		t.Fatalf("%q %v", x, err)
	}
	*now = now.Add(3 * time.Minute) // past expiry
	if _, err := c.Token(ctx); err == nil {
		t.Fatal("an expired token must not be served")
	}
}

func TestInvalidate(t *testing.T) {
	f, c, _ := newFake(t)
	ctx := context.Background()
	a, _ := c.Token(ctx)
	c.Invalidate()
	if b, _ := c.Token(ctx); a == b || f.calls.Load() != 2 {
		t.Fatal("invalidate must force a new fetch")
	}
}

func TestConfigRequired(t *testing.T) {
	if _, err := New(Config{Resource: "x"}); err == nil {
		t.Fatal("client id is required")
	}
	if _, err := New(Config{ClientID: "x"}); err == nil {
		t.Fatal("resource is required")
	}
}
