package limiter

import (
	"encoding/binary"
	"net/netip"
	"runtime"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time      { return c.t }
func (c *clock) add(d time.Duration) { c.t = c.t.Add(d) }
func newClock() *clock               { return &clock{t: time.Unix(1_800_000_000, 0)} }
func ip(s string) netip.Addr         { return netip.MustParseAddr(s) }

// Generous global limits, for the tests of the per-address budget.
func perKey(n int) Config {
	return Config{PerKey: n, Window: time.Hour, GlobalRate: 1e9, GlobalBurst: 1 << 30, MaxKeys: 1000}
}

func TestPerAddressBudgetAndRetryAfter(t *testing.T) {
	c := newClock()
	l := New(perKey(60), c.now)
	for i := range 60 {
		if d := l.Allow(ip("203.0.113.7")); !d.Allowed {
			t.Fatalf("request %d refused: %+v", i, d)
		}
	}
	c.add(10 * time.Minute)
	d := l.Allow(ip("203.0.113.7"))
	if d.Allowed || d.Scope != ScopeClient {
		t.Fatalf("61st request: %+v", d)
	}
	if d.RetryAfter != 50*time.Minute {
		t.Fatalf("retry after %v, want 50m", d.RetryAfter)
	}
	if !l.Allow(ip("203.0.113.8")).Allowed {
		t.Fatal("another address must have its own budget")
	}
	c.add(50 * time.Minute)
	if !l.Allow(ip("203.0.113.7")).Allowed {
		t.Fatal("the budget must return after the window")
	}
}

func TestIPv6IsKeyedBySlash64(t *testing.T) {
	l := New(perKey(2), newClock().now)
	if !l.Allow(ip("2001:db8:1:2::1")).Allowed || !l.Allow(ip("2001:db8:1:2:ffff:ffff:ffff:ffff")).Allowed {
		t.Fatal("two addresses within the budget were refused")
	}
	if d := l.Allow(ip("2001:db8:1:2:abcd::9")); d.Allowed {
		t.Fatal("a third address in the same /64 must share the budget")
	}
	if !l.Allow(ip("2001:db8:1:3::1")).Allowed {
		t.Fatal("the next /64 has its own budget")
	}
}

func TestIPv4MappedCountsAsIPv4(t *testing.T) {
	if KeyFor(ip("::ffff:203.0.113.7")) != KeyFor(ip("203.0.113.7")) {
		t.Fatal("an IPv4-mapped address must key as IPv4")
	}
	if KeyFor(ip("203.0.113.7")) == KeyFor(ip("203.0.113.8")) {
		t.Fatal("IPv4 addresses must not share a key")
	}
}

func TestGlobalCapRefillsAndLeavesNoEntry(t *testing.T) {
	c := newClock()
	l := New(Config{PerKey: 60, Window: time.Hour, GlobalRate: 5, GlobalBurst: 5, MaxKeys: 100}, c.now)
	for i := range 5 {
		if !l.Allow(ip("203.0.113.1")).Allowed {
			t.Fatalf("burst request %d refused", i)
		}
	}
	d := l.Allow(ip("203.0.113.2"))
	if d.Allowed || d.Scope != ScopeGlobal || d.RetryAfter <= 0 || d.RetryAfter > time.Second {
		t.Fatalf("over the cap: %+v", d)
	}
	if n, _ := l.Stats(); n != 1 {
		t.Fatalf("a refused request created an entry: %d tracked", n)
	}
	c.add(200 * time.Millisecond)
	if !l.Allow(ip("203.0.113.2")).Allowed {
		t.Fatal("one token should have returned after 200ms at 5/s")
	}
	if l.Allow(ip("203.0.113.3")).Allowed {
		t.Fatal("the bucket should be empty again")
	}
	c.add(time.Hour)
	for i := range 5 {
		if !l.Allow(ip("203.0.113.4")).Allowed {
			t.Fatalf("refilled burst %d refused", i)
		}
	}
	if l.Allow(ip("203.0.113.5")).Allowed {
		t.Fatal("the bucket must not exceed the burst")
	}
}

func TestAddressOverBudgetTakesNoGlobalToken(t *testing.T) {
	c := newClock()
	l := New(Config{PerKey: 1, Window: time.Hour, GlobalRate: 1, GlobalBurst: 2, MaxKeys: 100}, c.now)
	l.Allow(ip("203.0.113.1"))
	for range 100 {
		l.Allow(ip("203.0.113.1"))
	}
	if !l.Allow(ip("203.0.113.2")).Allowed {
		t.Fatal("one abusive address must not drain the global bucket")
	}
}

func v6(i uint64) netip.Addr {
	var b [16]byte
	b[0], b[1] = 0x20, 0x01
	binary.BigEndian.PutUint64(b[0:8], 0x2001_0000_0000_0000|i)
	return netip.AddrFrom16(b)
}

func TestMapIsBoundedAndForgetsTheOldest(t *testing.T) {
	c := newClock()
	cfg := perKey(1)
	cfg.MaxKeys = 3
	l := New(cfg, c.now)
	for i := range 3 {
		l.Allow(v6(uint64(i)))
		c.add(time.Second)
	}
	if l.Allow(v6(0)).Allowed {
		t.Fatal("still tracked: must be over budget")
	}
	l.Allow(v6(3)) // forgets v6(0)
	n, evicted := l.Stats()
	if n != 3 || evicted != 1 {
		t.Fatalf("tracked %d, evicted %d", n, evicted)
	}
	if !l.Allow(v6(0)).Allowed {
		t.Fatal("the oldest address should have been forgotten")
	}
	if l.Allow(v6(2)).Allowed {
		t.Fatal("a newer address must still be remembered")
	}
}

func TestExpiredEntriesLeaveTheMap(t *testing.T) {
	c := newClock()
	l := New(perKey(1), c.now)
	for i := range 500 {
		l.Allow(v6(uint64(i)))
	}
	c.add(time.Hour)
	l.Allow(v6(10_000))
	if n, _ := l.Stats(); n != 1 {
		t.Fatalf("%d entries after the window, want 1", n)
	}
}

// The limit the compose file relies on: the default 50,000 addresses, each from its own /64, in a
// 32 MiB container. Well under a quarter of it leaves room for the rest of the process.
func TestMemoryAtTheBoundFitsTheContainer(t *testing.T) {
	const maxKeys = 50_000
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	cfg := perKey(60)
	cfg.MaxKeys = maxKeys
	l := New(cfg, newClock().now)
	for i := range 4 * maxKeys {
		l.Allow(v6(uint64(i)))
	}
	runtime.GC()
	runtime.ReadMemStats(&after)
	if n, _ := l.Stats(); n != maxKeys {
		t.Fatalf("tracked %d", n)
	}
	used := int64(after.HeapAlloc) - int64(before.HeapAlloc)
	t.Logf("%d keys hold %.1f MiB of heap", maxKeys, float64(used)/(1<<20))
	if used > 8<<20 {
		t.Fatalf("%d bytes at the bound", used)
	}
	runtime.KeepAlive(l)
}
