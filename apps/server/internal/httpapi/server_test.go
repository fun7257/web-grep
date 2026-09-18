package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
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
		Search:  search.New(cfg, engine, kind, nil),
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

func TestSpaIndexNoCacheAndHashedAssets(t *testing.T) {
	s, _ := testServer(t, nil)
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html>ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.WebDist = dir
	h := s.Handler()

	idx := do(t, h, "GET", "http://127.0.0.1:8787/", "", nil)
	if idx.Code != 200 {
		t.Fatal(idx.Code, idx.Body.String())
	}
	if got := idx.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("index cache: %q", got)
	}
	if !strings.Contains(idx.Body.String(), "ok") {
		t.Fatal(idx.Body.String())
	}

	js := do(t, h, "GET", "http://127.0.0.1:8787/assets/app.js", "", nil)
	if js.Code != 200 {
		t.Fatal(js.Code, js.Body.String())
	}
	if got := js.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("asset cache: %q", got)
	}

	fallback := do(t, h, "GET", "http://127.0.0.1:8787/missing", "", nil)
	if fallback.Code != 200 || !strings.Contains(fallback.Body.String(), "ok") {
		t.Fatal(fallback.Code, fallback.Body.String())
	}
	if got := fallback.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("fallback cache: %q", got)
	}
}

func TestPublicPathPrefixStripsAndInjectsBase(t *testing.T) {
	s, _ := testServer(t, nil)
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	html := `<!doctype html><meta name="web-grep-base" content="__WEB_GREP_BASE__">ok`
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(html), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.Cfg.PublicPath = "/web-grep"
	s.WebDist = dir
	h := s.Handler()

	idx := do(t, h, "GET", "http://127.0.0.1:8787/web-grep/", "", nil)
	if idx.Code != 200 {
		t.Fatal(idx.Code, idx.Body.String())
	}
	if !strings.Contains(idx.Body.String(), `content="/web-grep/"`) {
		t.Fatalf("missing injected base: %s", idx.Body.String())
	}
	if strings.Contains(idx.Body.String(), "__WEB_GREP_BASE__") {
		t.Fatal("marker left in html")
	}

	js := do(t, h, "GET", "http://127.0.0.1:8787/web-grep/assets/app.js", "", nil)
	if js.Code != 200 || !strings.Contains(js.Body.String(), "console.log") {
		t.Fatal(js.Code, js.Body.String())
	}

	health := do(t, h, "GET", "http://127.0.0.1:8787/web-grep/api/health", "", nil)
	if health.Code != 200 {
		t.Fatal(health.Code, health.Body.String())
	}
	rootHealth := do(t, h, "GET", "http://127.0.0.1:8787/api/health", "", nil)
	if rootHealth.Code != 200 {
		t.Fatal(rootHealth.Code, rootHealth.Body.String())
	}
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
	if got.LimitToList {
		t.Fatal("no mtimeAfter should skip WalkDir and let rg search the root")
	}
	if len(got.FileList) != 0 {
		t.Fatalf("expected empty file list without mtime: %v", got.FileList)
	}
}

func TestSearchMtimeAfterLimitsFileList(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	oldTime := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(filepath.Join(root, "ok.txt"), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	fresh := filepath.Join(root, "fresh.log")
	if err := os.WriteFile(fresh, []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().Add(-2 * time.Hour).UnixMilli()
	body := fmt.Sprintf(`{"query":"hello","mtimeAfter":%d}`, cutoff)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", body, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if !got.LimitToList {
		t.Fatal("expected pre-filtered file list")
	}
	if !slices.Contains(got.FileList, "fresh.log") {
		t.Fatalf("missing fresh.log: %v", got.FileList)
	}
	if slices.Contains(got.FileList, "ok.txt") {
		t.Fatalf("old ok.txt should be excluded: %v", got.FileList)
	}
}

func TestSearchMtimeAfterRespectsGlobInclude(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	freshA := filepath.Join(root, "keep.log")
	freshB := filepath.Join(root, "skip.log")
	if err := os.WriteFile(freshA, []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(freshB, []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().Add(-2 * time.Hour).UnixMilli()
	body := fmt.Sprintf(`{"query":"hello","mtimeAfter":%d,"globInclude":["keep.log"]}`, cutoff)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", body, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if !got.LimitToList {
		t.Fatal("expected pre-filtered file list")
	}
	if !slices.Contains(got.FileList, "keep.log") {
		t.Fatalf("missing keep.log: %v", got.FileList)
	}
	if slices.Contains(got.FileList, "skip.log") {
		t.Fatalf("globInclude should drop skip.log: %v", got.FileList)
	}
}

func TestSearchSelectedPayloadAppliesModifiersAndGlobs(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"src/keep.ts":      "Hello\n",
		"src/skip.js":      "Hello\n",
		"src/keep.test.ts": "Hello\n",
		"src/wrongcase.ts": "hello\n",
		"other.ts":         "Hello\n",
	}
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"H.llo","regex":true,"caseSensitive":true,"wordMatch":true,"globInclude":["src/**"],"globAnd":["*.ts"],"globExclude":["*.test.ts"]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if !got.Regex || !got.CaseSensitive || !got.WordMatch {
		t.Fatalf("modifiers: regex=%v case=%v word=%v", got.Regex, got.CaseSensitive, got.WordMatch)
	}
	if got.LimitToList {
		t.Fatal("no mtimeAfter should skip WalkDir")
	}
	if !slices.Contains(got.GlobInclude, "src/**") {
		t.Fatalf("globInclude: %v", got.GlobInclude)
	}
	if !slices.Contains(got.GlobAnd, "*.ts") {
		t.Fatalf("globAnd: %v", got.GlobAnd)
	}
	if !slices.Contains(got.GlobExclude, "*.test.ts") {
		t.Fatalf("globExclude: %v", got.GlobExclude)
	}
}

func TestSearchGlobAndIntersectsInclude(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "a.ts"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "b.js"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "other.ts"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"hello","globInclude":["src/**"],"globAnd":["*.ts"]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if got.LimitToList {
		t.Fatal("no mtimeAfter should skip WalkDir")
	}
	if !slices.Contains(got.GlobInclude, "src/**") {
		t.Fatalf("globInclude: %v", got.GlobInclude)
	}
	if !slices.Contains(got.GlobAnd, "*.ts") {
		t.Fatalf("globAnd: %v", got.GlobAnd)
	}
}

func TestSearchGlobIncludeWithoutMtime(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	if err := os.WriteFile(filepath.Join(root, "keep.log"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skip.log"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "dir", "keep.log"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"hello","globInclude":["keep.log"]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if got.LimitToList {
		t.Fatal("no mtimeAfter should skip WalkDir; literals go to rg as anchored globs")
	}
	if !slices.Contains(got.GlobInclude, "keep.log") {
		t.Fatalf("globInclude: %v", got.GlobInclude)
	}
	if len(got.FileList) != 0 {
		t.Fatalf("should not pre-list files: %v", got.FileList)
	}
}

func TestSearchGlobExcludeWithMtime(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	if err := os.WriteFile(filepath.Join(root, "keep.log"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skip.log"), []byte("hello-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().Add(-2 * time.Hour).UnixMilli()
	body := fmt.Sprintf(`{"query":"hello","mtimeAfter":%d,"globExclude":["skip.log"]}`, cutoff)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", body, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if !slices.Contains(got.FileList, "keep.log") {
		t.Fatalf("missing keep.log: %v", got.FileList)
	}
	if slices.Contains(got.FileList, "skip.log") {
		t.Fatalf("exclude leaked skip.log: %v", got.FileList)
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
	if s.Search.Inflight() != 0 {
		t.Fatalf("slots leaked after BUSY burst: %d", s.Search.Inflight())
	}
	ok := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if ok.Code == 429 {
		t.Fatal("BUSY stuck after slots were released")
	}
	if ok.Code != 200 {
		t.Fatal(ok.Code, ok.Body.String())
	}
}

func TestSearchCancelReleasesSlot(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	eng := blockingEngine{started: started, release: release}
	s, _ := testServer(t, eng)
	h := s.Handler()

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("POST", "http://127.0.0.1:8787/api/search", strings.NewReader(`{"query":"hello"}`))
	req.Host = "127.0.0.1:8787"
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.ServeHTTP(rec, req)
	}()
	waitStarted(t, started, 1)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not return after cancel")
	}
	if s.Search.Inflight() != 0 {
		t.Fatalf("slot leaked after cancel: %d", s.Search.Inflight())
	}
	close(release)
	ok := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if ok.Code == 429 {
		t.Fatal("BUSY after cancelled search released its slot")
	}
	if ok.Code != 200 {
		t.Fatal(ok.Code, ok.Body.String())
	}
}

func TestSearchErrorReleasesSlot(t *testing.T) {
	s, _ := testServer(t, errEngine{err: fmt.Errorf("rg crashed")})
	h := s.Handler()
	rec := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "event: error") {
		t.Fatalf("expected engine error: %s", rec.Body.String())
	}
	if s.Search.Inflight() != 0 {
		t.Fatalf("slot leaked after error: %d", s.Search.Inflight())
	}
	ok := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello"}`, nil)
	if ok.Code == 429 {
		t.Fatal("BUSY after error should have released the slot")
	}
}

type errEngine struct{ err error }

func (e errEngine) Kind() string { return "rg" }
func (e errEngine) Search(context.Context, rg.Input, func(rg.Match) error, func(int)) error {
	return e.err
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

func TestLiveRipgrepOnlySearchesPrefilteredFiles(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "old.txt"), []byte("hello-needle in old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "new.txt"), []byte("hello-needle in new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(filepath.Join(root, "old.txt"), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	root, _ = filepath.EvalSymlinks(root)
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, TimeoutMs: 5000,
	}
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg", nil), Engine: "rg"}
	cutoff := time.Now().Add(-2 * time.Hour).UnixMilli()
	body := fmt.Sprintf(`{"query":"hello-needle","mtimeAfter":%d}`, cutoff)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", body, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	out := rec.Body.String()
	if !strings.Contains(out, "new.txt") {
		t.Fatalf("expected new.txt: %s", out)
	}
	if strings.Contains(out, "old.txt") {
		t.Fatalf("old.txt must not be searched: %s", out)
	}
}

func TestSearchAndTermsPerTermModifiers(t *testing.T) {
	var got rg.Input
	eng := captureEngine{onSearch: func(in rg.Input) {
		got = in
	}}
	s, root := testServer(t, eng)
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("Hello world\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"Hello","caseSensitive":true,"andTerms":[{"query":"world.*","regex":true}]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if !got.CaseSensitive || got.Regex {
		t.Fatalf("head flags: case=%v regex=%v", got.CaseSensitive, got.Regex)
	}
	if len(got.AndTerms) != 1 || got.AndTerms[0].Query != "world.*" || !got.AndTerms[0].Regex || got.AndTerms[0].CaseSensitive {
		t.Fatalf("piped term: %+v", got.AndTerms)
	}
}

func TestLiveRipgrepAndTermsAnyOrder(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	line := `"host":"test.gf.com.cn","route":"/trade-users/v1/me","industryType":"4","account":"030680228968"` + "\n"
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	root, _ = filepath.EvalSymlinks(root)
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, TimeoutMs: 5000, NoIgnore: true,
	}
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg", nil), Engine: "rg"}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"030680228968","andTerms":["industryType","trade-users","host"]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	out := rec.Body.String()
	if !strings.Contains(out, `"path":"ok.txt"`) {
		t.Fatalf("expected hit in any field order: %s", out)
	}
}

func TestLiveRipgrepSearchSelectedAdvancedOptions(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"src/keep.ts":      "Hello from keep\n",
		"src/skip.js":      "Hello from js\n",
		"src/keep.test.ts": "Hello from test\n",
		"src/wrongcase.ts": "hello from case\n",
		"src/partial.ts":   "HelloWorld\n",
		"other.ts":         "Hello from other\n",
	}
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	root, _ = filepath.EvalSymlinks(root)
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, TimeoutMs: 5000, NoIgnore: true,
	}
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg", nil), Engine: "rg"}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"H.llo","regex":true,"caseSensitive":true,"wordMatch":true,"globInclude":["src/**"],"globAnd":["*.ts"],"globExclude":["*.test.ts"]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	out := rec.Body.String()
	if !strings.Contains(out, `"path":"src/keep.ts"`) {
		t.Fatalf("expected src/keep.ts hit: %s", out)
	}
	for _, leak := range []string{"src/skip.js", "src/keep.test.ts", "src/wrongcase.ts", "src/partial.ts", "other.ts"} {
		if strings.Contains(out, leak) {
			t.Fatalf("advanced options leaked %s: %s", leak, out)
		}
	}
}

func TestLiveRipgrepMtimeAndGlobInclude(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "keep.txt"), []byte("hello-needle keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skip.txt"), []byte("hello-needle skip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, _ = filepath.EvalSymlinks(root)
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, TimeoutMs: 5000,
	}
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg", nil), Engine: "rg"}
	cutoff := time.Now().Add(-2 * time.Hour).UnixMilli()
	body := fmt.Sprintf(
		`{"query":"hello-needle","mtimeAfter":%d,"globInclude":["keep.txt"]}`,
		cutoff,
	)
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", body, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	out := rec.Body.String()
	if !strings.Contains(out, "keep.txt") {
		t.Fatalf("expected keep.txt: %s", out)
	}
	if strings.Contains(out, "skip.txt") {
		t.Fatalf("selected glob must not search skip.txt: %s", out)
	}
}

func TestLiveRipgrepLiteralGlobDoesNotMatchNested(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "keep.log"), []byte("hello-needle keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "dir", "keep.log"), []byte("hello-needle nested\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, _ = filepath.EvalSymlinks(root)
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, TimeoutMs: 5000, NoIgnore: true,
	}
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg", nil), Engine: "rg"}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"hello-needle","globInclude":["keep.log"]}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	out := rec.Body.String()
	if !strings.Contains(out, `"path":"keep.log"`) {
		t.Fatalf("expected root keep.log: %s", out)
	}
	if strings.Contains(out, "dir/keep.log") {
		t.Fatalf("literal pick must not match nested keep.log: %s", out)
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
	s := &Server{Cfg: cfg, Search: search.New(cfg, rg.Engine{Bin: bin}, "rg", nil), Engine: "rg"}
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", `{"query":"hello-needle","regex":false}`, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("hello-needle")) {
		t.Fatal(rec.Body.String())
	}
}
