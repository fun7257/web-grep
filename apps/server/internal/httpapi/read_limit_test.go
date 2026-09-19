package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
)

func setReadLimits(s *Server, maxConc, rate, windowMs int) {
	cfg := s.Config()
	cfg.ReadMaxConcurrent = maxConc
	cfg.ReadRateLimit = rate
	cfg.ReadRateWindowMs = windowMs
	s.SetConfig(cfg)
}

func doFrom(t *testing.T, h http.Handler, method, url, remote string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, url, nil)
	req.Host = "127.0.0.1:8787"
	req.RemoteAddr = remote
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestPinReadRateUnderLimitSucceeds(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	h := s.Handler()
	for i := 0; i < 20; i++ {
		tree := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
		if tree.Code != 200 {
			t.Fatalf("tree %d: %d %s", i, tree.Code, tree.Body.String())
		}
		count := do(t, h, "GET", "http://127.0.0.1:8787/api/count", "", nil)
		if count.Code != 200 {
			t.Fatalf("count %d: %d %s", i, count.Code, count.Body.String())
		}
		file := do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=ok.txt&line=1", "", nil)
		if file.Code != 200 {
			t.Fatalf("file %d: %d %s", i, file.Code, file.Body.String())
		}
	}
}

func TestPinReadRateOverLimitIsBusy(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	setReadLimits(s, 32, 2, 60_000)
	h := s.Handler()

	first := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if first.Code != 200 {
		t.Fatal(first.Body.String())
	}
	second := do(t, h, "GET", "http://127.0.0.1:8787/api/count", "", nil)
	if second.Code != 200 {
		t.Fatal(second.Body.String())
	}
	busy := do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=ok.txt&line=1", "", nil)
	if busy.Code != 429 || jsonCode(t, busy) != "BUSY" {
		t.Fatalf("expected BUSY after 2 reads, got %d %s", busy.Code, busy.Body.String())
	}
	if got := busy.Body.String(); !strings.Contains(got, "too many tree/count/file requests") {
		t.Fatalf("busy message: %s", got)
	}
}

func TestPinReadRateConfigChangesThreshold(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	setReadLimits(s, 32, 2, 60_000)
	h := s.Handler()

	if rec := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	busy := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if busy.Code != 429 || jsonCode(t, busy) != "BUSY" {
		t.Fatalf("rate=2 should BUSY the 3rd: %d %s", busy.Code, busy.Body.String())
	}

	setReadLimits(s, 32, 4, 60_000)
	ok := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if ok.Code != 200 {
		t.Fatalf("raising rate to 4 should admit the next request: %d %s", ok.Code, ok.Body.String())
	}

	setReadLimits(s, 32, 1, 60_000)
	still := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if still.Code != 429 || jsonCode(t, still) != "BUSY" {
		t.Fatalf("lowering rate to 1 should BUSY: %d %s", still.Code, still.Body.String())
	}
}

func TestPinReadConcurrentBusyThenRelease(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	setReadLimits(s, 1, 10_000, 60_000)
	h := s.Handler()

	req := httptest.NewRequest("GET", "http://127.0.0.1:8787/api/tree", nil)
	req.Host = "127.0.0.1:8787"
	key := s.clientKey(req)
	if !s.Reads.Acquire(key, time.Now(), 1, 10_000, time.Minute) {
		t.Fatal("hold slot")
	}
	if s.Reads.Inflight() != 1 {
		t.Fatalf("inflight=%d", s.Reads.Inflight())
	}

	busy := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if busy.Code != 429 || jsonCode(t, busy) != "BUSY" {
		t.Fatalf("expected concurrent BUSY, got %d %s", busy.Code, busy.Body.String())
	}
	countBusy := do(t, h, "GET", "http://127.0.0.1:8787/api/count", "", nil)
	if countBusy.Code != 429 || jsonCode(t, countBusy) != "BUSY" {
		t.Fatalf("count should share the cap: %d %s", countBusy.Code, countBusy.Body.String())
	}

	s.Reads.Release()
	ok := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if ok.Code != 200 {
		t.Fatalf("after release: %d %s", ok.Code, ok.Body.String())
	}
}

func TestPinReadRatePerIPIndependent(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	setReadLimits(s, 32, 1, 60_000)
	h := s.Handler()

	a := doFrom(t, h, "GET", "http://127.0.0.1:8787/api/tree", "10.0.0.1:9", nil)
	if a.Code != 200 {
		t.Fatal(a.Body.String())
	}
	aBusy := doFrom(t, h, "GET", "http://127.0.0.1:8787/api/tree", "10.0.0.1:9", nil)
	if aBusy.Code != 429 || jsonCode(t, aBusy) != "BUSY" {
		t.Fatalf("same IP should BUSY: %d %s", aBusy.Code, aBusy.Body.String())
	}
	b := doFrom(t, h, "GET", "http://127.0.0.1:8787/api/tree", "10.0.0.2:9", nil)
	if b.Code != 200 {
		t.Fatalf("other IP should pass: %d %s", b.Code, b.Body.String())
	}
}

func TestPinReadRatePerSessionIndependent(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	setReadLimits(s, 32, 1, 60_000)
	cfg := s.Config()
	cfg.TokenHash = config.HashPassword("secret1")
	s.SetConfig(cfg)
	s.Sessions = auth.NewSessions()
	h := s.Handler()

	tokenA := mustLogin(t, h, "secret1")
	tokenB := mustLogin(t, h, "secret1")

	okA := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenA,
	})
	if okA.Code != 200 {
		t.Fatal(okA.Body.String())
	}
	busyA := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenA,
	})
	if busyA.Code != 429 || jsonCode(t, busyA) != "BUSY" {
		t.Fatalf("session A should BUSY: %d %s", busyA.Code, busyA.Body.String())
	}
	okB := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenB,
	})
	if okB.Code != 200 {
		t.Fatalf("session B should have its own budget: %d %s", okB.Code, okB.Body.String())
	}
}

func TestPinReadLimitDoesNotAffectSearch(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	setReadLimits(s, 32, 1, 60_000)
	h := s.Handler()

	if rec := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil); rec.Code != 429 {
		t.Fatalf("tree should be limited: %d %s", rec.Code, rec.Body.String())
	}
	search := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if search.Code != 200 {
		t.Fatalf("search must stay on max_concurrent, not read limits: %d %s", search.Code, search.Body.String())
	}
}
