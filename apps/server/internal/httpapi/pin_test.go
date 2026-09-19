package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
)

// Step 2 pins: auth session, cancel-releases-slot, full concurrency.
// Handlers and search semantics are unchanged; these fail if a later
// hygiene/perf refactor regresses those behaviors.

func TestPinAuthSessionLoginRejectAndInvalidate(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	s.Cfg.TokenHash = config.HashPassword("secret1")
	s.Sessions = auth.NewSessions()
	h := s.Handler()

	assertAuthFail := func(hdr map[string]string) {
		t.Helper()
		tree := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", hdr)
		if tree.Code != 401 {
			t.Fatalf("tree: %d %s", tree.Code, tree.Body.String())
		}
		if got := jsonCode(t, tree); got != "UNAUTHORIZED" {
			t.Fatalf("tree code %q", got)
		}
		search := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, hdr)
		if search.Code != 401 {
			t.Fatalf("search: %d %s", search.Code, search.Body.String())
		}
		if got := jsonCode(t, search); got != "UNAUTHORIZED" {
			t.Fatalf("search code %q", got)
		}
	}

	assertAuthFail(nil)
	assertAuthFail(map[string]string{"Authorization": "Bearer"})
	assertAuthFail(map[string]string{"Authorization": "Bearer not-a-session"})
	assertAuthFail(map[string]string{"X-Web-Grep-Token": "not-a-session"})
	// Password is not a session token.
	assertAuthFail(map[string]string{"Authorization": "Bearer secret1"})
	assertAuthFail(map[string]string{"X-Web-Grep-Token": "secret1"})

	bad := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/login",
		`{"password":"nope-nope"}`, nil)
	if bad.Code != 401 || jsonCode(t, bad) != "INVALID_AUTH" {
		t.Fatalf("bad login: %d %s", bad.Code, bad.Body.String())
	}

	tokenA := mustLogin(t, h, "secret1")
	okBearer := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenA,
	})
	if okBearer.Code != 200 {
		t.Fatal(okBearer.Body.String())
	}
	okHeader := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"X-Web-Grep-Token": tokenA,
	})
	if okHeader.Code != 200 {
		t.Fatal(okHeader.Body.String())
	}
	okSearch := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, map[string]string{
		"Authorization": "Bearer " + tokenA,
	})
	if okSearch.Code != 200 {
		t.Fatal(okSearch.Body.String())
	}

	tokenB := mustLogin(t, h, "secret1")
	if tokenB == tokenA {
		t.Fatal("second login reused the first session token")
	}
	if rec := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenB,
	}); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}

	loggedOut := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/logout", "", map[string]string{
		"Authorization": "Bearer " + tokenA,
	})
	if loggedOut.Code != 200 {
		t.Fatal(loggedOut.Body.String())
	}
	var logoutBody map[string]any
	if err := json.Unmarshal(loggedOut.Body.Bytes(), &logoutBody); err != nil {
		t.Fatal(err)
	}
	if logoutBody["ok"] != true {
		t.Fatalf("logout body: %s", loggedOut.Body.String())
	}

	assertAuthFail(map[string]string{"Authorization": "Bearer " + tokenA})
	assertAuthFail(map[string]string{"X-Web-Grep-Token": tokenA})
	stillB := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenB,
	})
	if stillB.Code != 200 {
		t.Fatalf("logout must kick only that session: %d %s", stillB.Code, stillB.Body.String())
	}

	// Equivalent invalidate without HTTP: revoke the remaining session.
	s.Sessions.Revoke(tokenB)
	assertAuthFail(map[string]string{"Authorization": "Bearer " + tokenB})

	tokenC := mustLogin(t, h, "secret1")
	if rec := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + tokenC,
	}); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
}

func TestPinSearchCancelReleasesConcurrencySlot(t *testing.T) {
	const maxC = 2
	started := make(chan struct{}, maxC)
	release := make(chan struct{})
	eng := blockingEngine{started: started, release: release}
	s, _ := testServer(t, eng)
	setMaxConcurrent(s, maxC)
	h := s.Handler()

	cancel, done, _ := startSearch(t, h, nil)
	waitStarted(t, started, 1)
	if s.Search.Inflight() != 1 {
		t.Fatalf("expected 1 held slot, inflight=%d", s.Search.Inflight())
	}
	cancel()
	waitDone(t, done, "handler did not return after cancel")
	if s.Search.Inflight() != 0 {
		t.Fatalf("slot leaked after cancel: %d", s.Search.Inflight())
	}

	// Cancel must not leave sticky BUSY: fill the configured cap, then
	// cancel one held search and assert the freed slot can be acquired.
	var holds []heldSearch
	for i := 0; i < maxC; i++ {
		holds = append(holds, startHeldSearch(t, h, nil))
	}
	waitStarted(t, started, maxC)
	busy := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if busy.Code != 429 || jsonCode(t, busy) != "BUSY" {
		t.Fatalf("expected BUSY at cap, got %d %s", busy.Code, busy.Body.String())
	}

	holds[0].cancel()
	waitDone(t, holds[0].done, "cancelled search did not return")
	if s.Search.Inflight() != maxC-1 {
		t.Fatalf("cancel should free exactly one slot, inflight=%d", s.Search.Inflight())
	}

	replacement := startHeldSearch(t, h, nil)
	waitStarted(t, started, 1)
	if s.Search.Inflight() != maxC {
		t.Fatalf("replacement search did not take the freed slot: %d", s.Search.Inflight())
	}
	stillBusy := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if stillBusy.Code != 429 || jsonCode(t, stillBusy) != "BUSY" {
		t.Fatalf("cap should still reject extras after cancel+replace: %d %s", stillBusy.Code, stillBusy.Body.String())
	}

	close(release)
	waitDone(t, holds[1].done, "held search did not finish")
	waitDone(t, replacement.done, "replacement search did not finish")
	if s.Search.Inflight() != 0 {
		t.Fatalf("slots leaked after cancel path: %d", s.Search.Inflight())
	}
	ok := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if ok.Code == 429 {
		t.Fatal("sticky BUSY after cancel released its slot")
	}
	if ok.Code != 200 {
		t.Fatal(ok.Code, ok.Body.String())
	}
}

func TestPinSearchMaxConcurrentBusyThenOneRelease(t *testing.T) {
	n := config.MaxConcurrentDefault
	started := make(chan struct{}, n)
	release := make(chan struct{})
	eng := blockingEngine{started: started, release: release}
	s, _ := testServer(t, eng)
	if s.Cfg.MaxConcurrent != n {
		t.Fatalf("testServer MaxConcurrent=%d want default %d", s.Cfg.MaxConcurrent, n)
	}
	h := s.Handler()

	finished := make(chan struct{}, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
			finished <- struct{}{}
		}()
	}
	waitStarted(t, started, n)
	if s.Search.Inflight() != n {
		t.Fatalf("inflight=%d want %d", s.Search.Inflight(), n)
	}

	busy := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if busy.Code != 429 {
		t.Fatalf("got %d %s", busy.Code, busy.Body.String())
	}
	if jsonCode(t, busy) != "BUSY" {
		t.Fatalf("%s", busy.Body.String())
	}
	if s.Search.Inflight() != n {
		t.Fatalf("BUSY must not take a slot: inflight=%d", s.Search.Inflight())
	}

	release <- struct{}{}
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("released search did not finish")
	}
	if s.Search.Inflight() != n-1 {
		t.Fatalf("one release should free one slot, inflight=%d", s.Search.Inflight())
	}

	nextDone := make(chan struct{})
	go func() {
		defer close(nextDone)
		do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	}()
	deadline := time.After(2 * time.Second)
	for s.Search.Inflight() < n {
		select {
		case <-started:
		case <-deadline:
			t.Fatalf("replacement search did not acquire a slot, inflight=%d", s.Search.Inflight())
		}
	}
	stillBusy := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if stillBusy.Code != 429 || jsonCode(t, stillBusy) != "BUSY" {
		t.Fatalf("still at cap after one replacement: %d %s", stillBusy.Code, stillBusy.Body.String())
	}

	close(release)
	wg.Wait()
	waitDone(t, nextDone, "replacement search did not finish")
	if s.Search.Inflight() != 0 {
		t.Fatalf("slots leaked: %d", s.Search.Inflight())
	}
	ok := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if ok.Code == 429 {
		t.Fatal("BUSY stuck after slots were released")
	}
	if ok.Code != 200 {
		t.Fatal(ok.Code, ok.Body.String())
	}
}

func TestPinSearchConfiguredMaxConcurrent(t *testing.T) {
	const maxC = 2
	started := make(chan struct{}, maxC)
	release := make(chan struct{})
	s, _ := testServer(t, blockingEngine{started: started, release: release})
	setMaxConcurrent(s, maxC)
	h := s.Handler()

	var wg sync.WaitGroup
	wg.Add(maxC)
	for i := 0; i < maxC; i++ {
		go func() {
			defer wg.Done()
			do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
		}()
	}
	waitStarted(t, started, maxC)
	busy := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if busy.Code != 429 || jsonCode(t, busy) != "BUSY" {
		t.Fatalf("configured max=%d should BUSY extras: %d %s", maxC, busy.Code, busy.Body.String())
	}
	close(release)
	wg.Wait()
	ok := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if ok.Code != 200 {
		t.Fatal(ok.Code, ok.Body.String())
	}
}

type heldSearch struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func startHeldSearch(t *testing.T, h http.Handler, hdr map[string]string) heldSearch {
	t.Helper()
	cancel, done, _ := startSearch(t, h, hdr)
	return heldSearch{cancel: cancel, done: done}
}

func startSearch(t *testing.T, h http.Handler, hdr map[string]string) (context.CancelFunc, chan struct{}, *httptest.ResponseRecorder) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("POST", "http://127.0.0.1:8787/api/search", strings.NewReader(`{"query":"hello"}`))
	req.Host = "127.0.0.1:8787"
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.ServeHTTP(rec, req)
	}()
	return cancel, done, rec
}

func setMaxConcurrent(s *Server, n int) {
	cfg := s.Cfg
	cfg.MaxConcurrent = n
	s.Cfg = cfg
	s.Search.SetCfg(cfg)
}

func mustLogin(t *testing.T, h http.Handler, password string) string {
	t.Helper()
	login := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/login",
		`{"password":"`+password+`"}`, nil)
	if login.Code != 200 {
		t.Fatal(login.Body.String())
	}
	var sess struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &sess); err != nil {
		t.Fatal(err)
	}
	if sess.Token == "" {
		t.Fatal("empty session")
	}
	return sess.Token
}

func jsonCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body["code"]
}

func waitDone(t *testing.T, done <-chan struct{}, msg string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal(msg)
	}
}
