package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/rg"
	"web-grep/internal/search"
)

type fakeEngine struct {
	matches []rg.Match
}

func (f fakeEngine) Kind() string { return "rg" }
func (f fakeEngine) Search(ctx context.Context, in rg.Input, emit func(rg.Match) error, _ func(int)) error {
	for _, m := range f.matches {
		if err := emit(m); err != nil {
			return err
		}
	}
	return nil
}

func testServer(t *testing.T, engine search.Engine) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("SECRET=1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		RootReal:       root,
		RootLabel:      filepath.Base(root),
		Host:           "127.0.0.1",
		Port:           8787,
		MaxResults:     10000,
		MaxResultsHard: 50000,
		TimeoutMs:      30000,
		MaxConcurrent:  config.MaxConcurrentDefault,
		PreviewBytes:   1 << 20,
		PreviewLines:   201,
	}
	kind := "none"
	if engine != nil {
		kind = "rg"
	}
	return &Server{
		Cfg:     cfg,
		Search:  search.New(cfg, engine, kind),
		Engine:  kind,
		Version: "",
	}, root
}

func do(t *testing.T, h http.Handler, method, url, body string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, url, rdr)
	req.Host = "127.0.0.1:8787"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTreeListsRoot(t *testing.T) {
	s, _ := testServer(t, nil)
	rec := do(t, s.Handler(), "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	var body struct {
		Entries []struct {
			Name string `json:"name"`
			Dir  bool   `json:"dir"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range body.Entries {
		if e.Name == "ok.txt" && !e.Dir {
			found = true
		}
		if e.Name == ".env" {
			t.Fatal("denied/hidden .env listed")
		}
	}
	if !found {
		t.Fatalf("ok.txt missing: %+v", body.Entries)
	}
}

func TestHealthAndForbiddenHost(t *testing.T) {
	s, _ := testServer(t, nil)
	h := s.Handler()
	rec := do(t, h, "GET", "http://127.0.0.1:8787/api/health", "", nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	req := httptest.NewRequest("GET", "http://0.0.0.0:8787/api/health", nil)
	req.Host = "0.0.0.0:8787"
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != 403 {
		t.Fatalf("got %d %s", rec2.Code, rec2.Body.String())
	}
}

func TestEmptyQuery(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", `{"query":""}`, nil)
	if rec.Code != 400 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["code"] != "INVALID_QUERY" {
		t.Fatalf("%v", body)
	}
}

func TestSearchHitsAndPreviewDenied(t *testing.T) {
	eng := fakeEngine{matches: []rg.Match{{
		Path: "ok.txt", Line: 1, Text: "hello-needle\n",
		Submatches: [][2]int{{0, 5}},
	}}}
	s, _ := testServer(t, eng)
	h := s.Handler()
	rec := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	raw := rec.Body.String()
	if !strings.Contains(raw, "event: hit") || !strings.Contains(raw, "event: done") {
		t.Fatalf("sse: %s", raw)
	}
	if !strings.Contains(raw, `"path":"ok.txt"`) {
		t.Fatalf("path: %s", raw)
	}

	den := do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=.env&line=1", "", nil)
	if den.Code != 403 {
		t.Fatal(den.Code, den.Body.String())
	}

	ok := do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=ok.txt&line=1", "", nil)
	if ok.Code != 200 {
		t.Fatal(ok.Code, ok.Body.String())
	}
}

func TestOriginLoopbackVite(t *testing.T) {
	s, _ := testServer(t, nil)
	rec := do(t, s.Handler(), "GET", "http://127.0.0.1:8787/api/health", "", map[string]string{
		"Origin": "http://localhost:5173",
	})
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
}

func TestSearchDefaultsMatchUI(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, _ := testServer(t, eng)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if got.Regex || got.CaseSensitive || !got.Hidden {
		t.Fatalf("defaults: regex=%v case=%v hidden=%v", got.Regex, got.CaseSensitive, got.Hidden)
	}
}

func TestThirdSearchIsBusy(t *testing.T) {
	n := config.MaxConcurrentDefault
	started := make(chan struct{}, n)
	release := make(chan struct{})
	eng := blockingEngine{started: started, release: release}
	s, _ := testServer(t, eng)
	h := s.Handler()

	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
		}()
	}
	waitStarted(t, started, n)
	rec := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if rec.Code != 429 {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["code"] != "BUSY" {
		t.Fatalf("%v", body)
	}
	close(release)
	wg.Wait()
}

type captureEngine struct {
	onSearch func(rg.Input)
}

func (c captureEngine) Kind() string { return "rg" }
func (c captureEngine) Search(_ context.Context, in rg.Input, _ func(rg.Match) error, _ func(int)) error {
	if c.onSearch != nil {
		c.onSearch(in)
	}
	return nil
}

type blockingEngine struct {
	started chan struct{}
	release chan struct{}
}

func (b blockingEngine) Kind() string { return "rg" }
func (b blockingEngine) Search(ctx context.Context, _ rg.Input, _ func(rg.Match) error, _ func(int)) error {
	select {
	case b.started <- struct{}{}:
	default:
	}
	select {
	case <-b.release:
	case <-ctx.Done():
	}
	return nil
}

func waitStarted(t *testing.T, started chan struct{}, n int) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for i := 0; i < n; i++ {
		select {
		case <-started:
		case <-deadline:
			t.Fatal("searches did not start")
		}
	}
}

func TestEngineMissing(t *testing.T) {
	s, _ := testServer(t, nil)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", `{"query":"x"}`, nil)
	if rec.Code != 503 {
		t.Fatal(rec.Code, rec.Body.String())
	}
}

func TestLiveRipgrep(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, _ = filepath.EvalSymlinks(root)
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, MaxResultsHard: 50000, TimeoutMs: 5000,
		PreviewBytes: 1 << 20, PreviewLines: 201,
	}
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg"), Engine: "rg"}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello-needle","regex":false}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("hello-needle")) {
		t.Fatal(rec.Body.String())
	}
}
