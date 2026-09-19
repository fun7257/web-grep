package ratelimit

import (
	"testing"
	"time"
)

func TestAcquireUnderLimitThenBusy(t *testing.T) {
	lim := New()
	now := time.Unix(1_700_000_000, 0)
	window := 10 * time.Second

	if !lim.Acquire("ip:1", now, 8, 2, window) {
		t.Fatal("first should pass")
	}
	if !lim.Acquire("ip:1", now.Add(time.Millisecond), 8, 2, window) {
		t.Fatal("second should pass")
	}
	if lim.Acquire("ip:1", now.Add(2*time.Millisecond), 8, 2, window) {
		t.Fatal("third should be rate-limited")
	}
	if lim.Inflight() != 2 {
		t.Fatalf("inflight=%d", lim.Inflight())
	}
	lim.Release()
	lim.Release()
	if lim.Inflight() != 0 {
		t.Fatalf("release leaked: %d", lim.Inflight())
	}
}

func TestAcquireConcurrentCap(t *testing.T) {
	lim := New()
	now := time.Unix(1_700_000_000, 0)
	window := time.Hour

	if !lim.Acquire("a", now, 1, 100, window) {
		t.Fatal("first slot")
	}
	if lim.Acquire("b", now, 1, 100, window) {
		t.Fatal("second client should still hit global concurrent cap")
	}
	if lim.Inflight() != 1 {
		t.Fatalf("BUSY must not take a slot: %d", lim.Inflight())
	}
	lim.Release()
	if !lim.Acquire("b", now.Add(time.Millisecond), 1, 100, window) {
		t.Fatal("after release")
	}
	lim.Release()
}

func TestAcquireRateIndependentPerKey(t *testing.T) {
	lim := New()
	now := time.Unix(1_700_000_000, 0)
	window := 10 * time.Second

	if !lim.Acquire("ip:1", now, 8, 1, window) {
		t.Fatal("ip1")
	}
	if !lim.Acquire("ip:2", now, 8, 1, window) {
		t.Fatal("ip2 should have its own budget")
	}
	if lim.Acquire("ip:1", now.Add(time.Millisecond), 8, 1, window) {
		t.Fatal("ip1 exhausted")
	}
	lim.Release()
	lim.Release()
}

func TestAcquireRaisingRateAdmitsNext(t *testing.T) {
	lim := New()
	now := time.Unix(1_700_000_000, 0)
	window := 10 * time.Second

	if !lim.Acquire("ip:1", now, 8, 1, window) {
		t.Fatal("at 1")
	}
	if lim.Acquire("ip:1", now.Add(time.Millisecond), 8, 1, window) {
		t.Fatal("still at 1")
	}
	if !lim.Acquire("ip:1", now.Add(2*time.Millisecond), 8, 3, window) {
		t.Fatal("raising rate to 3 should admit the next request")
	}
	lim.Release()
	lim.Release()
}

func TestAcquireWindowExpiry(t *testing.T) {
	lim := New()
	now := time.Unix(1_700_000_000, 0)
	window := time.Second

	if !lim.Acquire("ip:1", now, 8, 1, window) {
		t.Fatal("first")
	}
	if lim.Acquire("ip:1", now.Add(500*time.Millisecond), 8, 1, window) {
		t.Fatal("inside window")
	}
	if !lim.Acquire("ip:1", now.Add(1100*time.Millisecond), 8, 1, window) {
		t.Fatal("after window should pass")
	}
	lim.Release()
	lim.Release()
}

func TestAcquireZeroRateMeansUnlimited(t *testing.T) {
	lim := New()
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < 20; i++ {
		if !lim.Acquire("ip:1", now.Add(time.Duration(i)*time.Millisecond), 64, 0, time.Second) {
			t.Fatalf("rate=0 should be unlimited, i=%d", i)
		}
	}
	for i := 0; i < 20; i++ {
		lim.Release()
	}
}
