// Package limiter is the sidecar's in-memory rate limit: a request budget per client address per
// window, and one global token bucket across all visitors. Its memory is bounded: at most MaxKeys
// addresses are tracked, in a fixed-size ring and a map without pointers.
package limiter

import (
	"net/netip"
	"sync"
	"time"
)

// Config sets the limits. Zero values are invalid: New panics on them, main validates first.
type Config struct {
	PerKey      int           // requests per address per Window
	Window      time.Duration // length of one address's budget
	GlobalRate  float64       // sustained requests per second across all visitors
	GlobalBurst int           // bucket size
	MaxKeys     int           // tracked addresses; the oldest is forgotten beyond this
}

// Scope says which limit refused a request.
type Scope string

const (
	ScopeNone   Scope = ""
	ScopeClient Scope = "client"
	ScopeGlobal Scope = "global"
)

// Decision is the answer for one request.
type Decision struct {
	Allowed    bool
	Scope      Scope
	RetryAfter time.Duration
}

type key = [16]byte

type entry struct {
	count   int32
	resetAt int64 // unix nanoseconds
}

type ringItem struct {
	k       key
	resetAt int64
}

// Limiter is safe for concurrent use.
type Limiter struct {
	cfg Config
	now func() time.Time

	mu      sync.Mutex
	entries map[key]entry
	// Insertion order is expiry order (every window has the same length), so the ring is both
	// the expiry queue and the eviction order. Each key in the map has exactly one ring item.
	ring       []ringItem
	head, size int
	tokens     float64
	last       time.Time
	evicted    uint64
}

// New builds a limiter. now may be nil (time.Now).
func New(cfg Config, now func() time.Time) *Limiter {
	if cfg.PerKey <= 0 || cfg.Window <= 0 || cfg.GlobalRate <= 0 || cfg.GlobalBurst <= 0 || cfg.MaxKeys <= 0 {
		panic("limiter: every limit must be positive")
	}
	if now == nil {
		now = time.Now
	}
	return &Limiter{
		cfg:     cfg,
		now:     now,
		entries: make(map[key]entry),
		ring:    make([]ringItem, cfg.MaxKeys),
		tokens:  float64(cfg.GlobalBurst),
		last:    now(),
	}
}

// KeyFor is the identity of an address: the whole IPv4 address, or the /64 of an IPv6 address,
// since one subscriber usually holds a whole /64. An IPv4-mapped IPv6 address counts as IPv4.
func KeyFor(addr netip.Addr) key {
	addr = addr.Unmap().WithZone("")
	if addr.Is6() {
		if p, err := addr.Prefix(64); err == nil {
			addr = p.Addr()
		}
	}
	return addr.As16()
}

// Allow takes one request from both budgets, or from neither. A request the global cap refuses
// does not create an address entry, so a flood above the cap cannot grow the map.
func (l *Limiter) Allow(addr netip.Addr) Decision {
	k := KeyFor(addr)
	now := l.now()
	nowNs := now.UnixNano()

	l.mu.Lock()
	defer l.mu.Unlock()

	l.expire(nowNs)
	l.refill(now)

	e, known := l.entries[k]
	if known && int(e.count) >= l.cfg.PerKey {
		return Decision{Scope: ScopeClient, RetryAfter: time.Duration(e.resetAt - nowNs)}
	}
	if l.tokens < 1 {
		wait := time.Duration((1 - l.tokens) / l.cfg.GlobalRate * float64(time.Second))
		return Decision{Scope: ScopeGlobal, RetryAfter: wait}
	}
	l.tokens--

	if known {
		e.count++
		l.entries[k] = e
		return Decision{Allowed: true}
	}
	if l.size == len(l.ring) {
		l.evictOldest()
	}
	resetAt := nowNs + int64(l.cfg.Window)
	l.entries[k] = entry{count: 1, resetAt: resetAt}
	l.ring[(l.head+l.size)%len(l.ring)] = ringItem{k: k, resetAt: resetAt}
	l.size++
	return Decision{Allowed: true}
}

func (l *Limiter) expire(nowNs int64) {
	for l.size > 0 {
		it := l.ring[l.head]
		if it.resetAt > nowNs {
			return
		}
		delete(l.entries, it.k)
		l.head = (l.head + 1) % len(l.ring)
		l.size--
	}
}

func (l *Limiter) evictOldest() {
	delete(l.entries, l.ring[l.head].k)
	l.head = (l.head + 1) % len(l.ring)
	l.size--
	l.evicted++
}

func (l *Limiter) refill(now time.Time) {
	elapsed := now.Sub(l.last).Seconds()
	if elapsed <= 0 {
		return
	}
	l.last = now
	l.tokens += elapsed * l.cfg.GlobalRate
	if burst := float64(l.cfg.GlobalBurst); l.tokens > burst {
		l.tokens = burst
	}
}

// Stats reports the tracked addresses and how many were forgotten early.
func (l *Limiter) Stats() (tracked int, evicted uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries), l.evicted
}
