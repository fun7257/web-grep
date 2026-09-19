package ratelimit

import (
	"sync"
	"time"
)

const maxKeys = 4096

// Limiter combines a global in-flight cap (same idea as search MaxConcurrent)
// with a per-key sliding window. Keys are typically a session id or peer IP.
type Limiter struct {
	mu       sync.Mutex
	inflight int
	buckets  map[string]*bucket
}

type bucket struct {
	times []time.Time
}

func New() *Limiter {
	return &Limiter{buckets: make(map[string]*bucket)}
}

// Acquire records one attempt. On success the caller must Release when the
// work finishes so the concurrent slot is returned. Rejected attempts do not
// take a slot. An attempt that is already over the rate is not recorded again
// (so a later higher limit or expired window can admit the next request).
func (l *Limiter) Acquire(key string, now time.Time, maxConc, rate int, window time.Duration) bool {
	if l == nil {
		return true
	}
	if key == "" {
		key = "unknown"
	}
	if window <= 0 {
		window = time.Second
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	n := l.pruneKeyLocked(key, now, window)
	if rate > 0 && n >= rate {
		return false
	}
	if maxConc > 0 && l.inflight >= maxConc {
		l.recordLocked(key, now, window)
		return false
	}
	l.recordLocked(key, now, window)
	l.inflight++
	return true
}

func (l *Limiter) Release() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inflight > 0 {
		l.inflight--
	}
}

func (l *Limiter) Inflight() int {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.inflight
}

func (l *Limiter) pruneKeyLocked(key string, now time.Time, window time.Duration) int {
	b := l.buckets[key]
	if b == nil {
		return 0
	}
	cutoff := now.Add(-window)
	kept := b.times[:0]
	for _, t := range b.times {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.buckets, key)
		return 0
	}
	b.times = kept
	return len(kept)
}

func (l *Limiter) recordLocked(key string, now time.Time, window time.Duration) {
	if l.buckets == nil {
		l.buckets = make(map[string]*bucket)
	}
	if len(l.buckets) >= maxKeys {
		if _, ok := l.buckets[key]; !ok {
			l.evictOneLocked(now, window, key)
		}
	}
	b := l.buckets[key]
	if b == nil {
		b = &bucket{}
		l.buckets[key] = b
	}
	b.times = append(b.times, now)
}

func (l *Limiter) evictOneLocked(now time.Time, window time.Duration, keep string) {
	cutoff := now.Add(-window)
	for k, b := range l.buckets {
		if k == keep {
			continue
		}
		empty := true
		for _, t := range b.times {
			if t.After(cutoff) {
				empty = false
				break
			}
		}
		if empty {
			delete(l.buckets, k)
			return
		}
	}
	for k := range l.buckets {
		if k != keep {
			delete(l.buckets, k)
			return
		}
	}
}
