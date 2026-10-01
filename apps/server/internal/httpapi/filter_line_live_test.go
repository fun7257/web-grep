package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/rg"
)

type liveSSE struct {
	events   []string
	hits     []map[string]any
	progress []map[string]any
	done     map[string]any
	errEv    map[string]any
}

func parseLiveSSE(t *testing.T, body string) liveSSE {
	t.Helper()
	var out liveSSE
	for _, block := range strings.Split(body, "\n\n") {
		block = strings.TrimSpace(block)
		if block == "" || strings.HasPrefix(block, ":") {
			continue
		}
		var name, data string
		for _, line := range strings.Split(block, "\n") {
			if v, ok := strings.CutPrefix(line, "event: "); ok {
				name = v
			} else if v, ok := strings.CutPrefix(line, "data: "); ok {
				data = v
			}
		}
		if name == "" {
			continue
		}
		out.events = append(out.events, name)
		switch name {
		case "hit":
			var hit map[string]any
			if err := json.Unmarshal([]byte(data), &hit); err != nil {
				t.Fatalf("hit json: %v %s", err, data)
			}
			out.hits = append(out.hits, hit)
		case "progress":
			var ev map[string]any
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				t.Fatalf("progress json: %v %s", err, data)
			}
			out.progress = append(out.progress, ev)
		case "done":
			out.done = map[string]any{}
			if err := json.Unmarshal([]byte(data), &out.done); err != nil {
				t.Fatalf("done json: %v %s", err, data)
			}
		case "error":
			out.errEv = map[string]any{}
			if err := json.Unmarshal([]byte(data), &out.errEv); err != nil {
				t.Fatalf("error json: %v %s", err, data)
			}
		}
	}
	return out
}

func hitTexts(hits []map[string]any) []string {
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		s, _ := h["text"].(string)
		out = append(out, s)
	}
	return out
}

func searchLive(t *testing.T, s *Server, body string) liveSSE {
	t.Helper()
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search", body, nil)
	assertSearchOK(t, rec)
	return parseLiveSSE(t, rec.Body.String())
}

func TestPinLiveFilterOnLineText(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "a.txt", []byte("g one\ng two\n"))
		writeRel(t, root, "b.txt", []byte("g xyz\n"))
		writeRel(t, root, "dir/zzz.txt", []byte("g zzz\n"))
		writeRel(t, root, "c.txt", []byte("go go go\nnothing here\ngreat day\n"))
	})
	all := []string{"g one", "g two", "g xyz", "g zzz", "go go go", "nothing here", "great day"}
	got := hitTexts(searchLive(t, s, `{"query":"g"}`).hits)
	if !sameSet(got, all) {
		t.Fatalf("unfiltered = %v", got)
	}

	cases := []struct {
		name string
		body string
		want []string
	}{
		{"i", `{"query":"g","filterTerms":["i"]}`, []string{"nothing here"}},
		{"path", `{"query":"g","filterTerms":["path"]}`, nil},
		{"txt", `{"query":"g","filterTerms":["txt"]}`, nil},
		{"anchorGo", `{"query":"g","filterTerms":[{"query":"^go","regex":true}]}`, []string{"go go go"}},
		{"anchorEnd", `{"query":"g","filterTerms":[{"query":"^g.*y$","regex":true}]}`, []string{"great day"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sse := searchLive(t, s, tc.body)
			if sse.errEv != nil {
				t.Fatalf("error event %v", sse.errEv)
			}
			got := hitTexts(sse.hits)
			if !sameSet(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestPinLiveFilterShortLine(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "only.txt", []byte("g\n"))
	})
	cases := []struct {
		name string
		body string
		want []string
	}{
		{"pass", `{"query":"g","regex":false,"filterTerms":[{"query":"g","regex":false}]}`, []string{"g"}},
		{"fail", `{"query":"g","filterTerms":["zzz"]}`, nil},
		{"three", `{"query":"g","filterTerms":[{"query":"g","regex":false},{"query":"g","caseSensitive":true},{"query":".","regex":true}]}`, []string{"g"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start := time.Now()
			sse := searchLive(t, s, tc.body)
			elapsed := time.Since(start)
			t.Logf("elapsed=%s", elapsed)
			if elapsed > time.Second {
				t.Fatalf("short line took %s", elapsed)
			}
			if sse.errEv != nil {
				t.Fatalf("error event %v", sse.errEv)
			}
			if sse.done == nil {
				t.Fatal("missing done")
			}
			if sse.done["timedOut"] == true {
				t.Fatalf("done timed out: %v", sse.done)
			}
			got := hitTexts(sse.hits)
			if !sameSet(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
			wantN := float64(len(tc.want))
			if sse.done["matchCount"] != wantN {
				t.Fatalf("matchCount=%v want %v", sse.done["matchCount"], wantN)
			}
		})
	}
}

func TestPinLiveFilterJSONFieldNames(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "c.txt", []byte("go go go\n"))
	})
	for _, term := range []string{"i", "path", "line_number", "text", "lines"} {
		t.Run(term, func(t *testing.T) {
			body := fmt.Sprintf(`{"query":"go","filterTerms":[%q]}`, term)
			got := hitTexts(searchLive(t, s, body).hits)
			if len(got) != 0 {
				t.Fatalf("filter %q matched %v", term, got)
			}
		})
	}
}

func TestPinLiveFilterFilenameNotContent(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "uniqname.txt", []byte("hello needle\n"))
		writeRel(t, root, "other.txt", []byte("hello uniqname needle\n"))
	})
	got := hitTexts(searchLive(t, s, `{"query":"needle","filterTerms":["uniqname"]}`).hits)
	if !sameSet(got, []string{"hello uniqname needle"}) {
		t.Fatalf("got %v", got)
	}
}

func TestPinLiveFilterAnchorsAndCRLF(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "a.txt", []byte("foo bar\nx foo\nxx bar\nbar yy\n"))
		writeRel(t, root, "cr.txt", []byte("great day\r\n"))
		writeRel(t, root, "lf.txt", []byte("great day\n"))
	})
	got := hitTexts(searchLive(t, s, `{"query":"foo","filterTerms":[{"query":"^foo","regex":true}]}`).hits)
	if !sameSet(got, []string{"foo bar"}) {
		t.Fatalf("^foo = %v", got)
	}
	got = hitTexts(searchLive(t, s, `{"query":"bar","filterTerms":[{"query":"bar$","regex":true}]}`).hits)
	if !sameSet(got, []string{"foo bar", "xx bar"}) {
		t.Fatalf("bar$ = %v", got)
	}

	bin := rg.Detect("")
	root := s.Config().RootReal
	head := headRgTexts(t, bin, root, "day$")
	filtered := hitTexts(searchLive(t, s, `{"query":"day","filterTerms":[{"query":"day$","regex":true}]}`).hits)
	if !sameSet(filtered, head) {
		t.Fatalf("filter day$ = %v, head rg = %v", filtered, head)
	}
}

func headRgTexts(t *testing.T, bin, root, pattern string) []string {
	t.Helper()
	cmd := exec.Command(bin, "--no-config", "--no-heading", "-n", "--", pattern, ".")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == 1 {
			return nil
		}
		t.Fatalf("head rg: %v", err)
	}
	var texts []string
	for _, line := range strings.Split(strings.TrimSuffix(string(out), "\n"), "\n") {
		if line == "" {
			continue
		}
		// file:line:text  (text itself has no colon in these fixtures)
		_, rest, ok := strings.Cut(line, ":")
		if !ok {
			t.Fatalf("rg line %q", line)
		}
		_, text, ok := strings.Cut(rest, ":")
		if !ok {
			t.Fatalf("rg line %q", line)
		}
		texts = append(texts, strings.TrimRight(text, "\r"))
	}
	return texts
}

func TestPinLiveFilterModifiersAND(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "keep.txt", []byte("Go is here\n"))
		writeRel(t, root, "noword.txt", []byte("Go is hereandthere\n"))
		writeRel(t, root, "noanchor.txt", []byte("xx Go is here\n"))
	})
	body := `{"query":"Go","regex":true,"caseSensitive":true,"wordMatch":true,"filterTerms":[{"query":"go"},{"query":"here","wordMatch":true},{"query":"^Go","regex":true}]}`
	got := hitTexts(searchLive(t, s, body).hits)
	if !sameSet(got, []string{"Go is here"}) {
		t.Fatalf("got %v", got)
	}
}

func TestPinLiveFilterSpecialLineBytes(t *testing.T) {
	raw := []byte("before \xff\xfe MARK\n")
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "quote.txt", []byte("say \"hi\" MARK\n"))
		writeRel(t, root, "bs.txt", []byte("a\\b MARK\n"))
		writeRel(t, root, "tab.txt", []byte("a\tb MARK\n"))
		writeRel(t, root, "zh.txt", []byte("你好 MARK\n"))
		writeRel(t, root, "bin.txt", raw)
		writeRel(t, root, "tail.txt", []byte("tail MARK"))
	})
	cases := []struct {
		name string
		body string
		want []string
	}{
		{"quote", `{"query":"MARK","filterTerms":[{"query":"^say \"hi\" MARK$","regex":true}]}`, []string{`say "hi" MARK`}},
		{"backslash", `{"query":"MARK","filterTerms":[{"query":"^a\\\\b MARK$","regex":true}]}`, []string{`a\b MARK`}},
		{"tab", "{\"query\":\"MARK\",\"filterTerms\":[{\"query\":\"^a\\tb MARK$\",\"regex\":true}]}", []string{"a\tb MARK"}},
		{"han", `{"query":"MARK","filterTerms":[{"query":"^你好","regex":true}]}`, []string{"你好 MARK"}},
		{"bytes", `{"query":"MARK","filterTerms":["before"]}`, []string{"before \uFFFD MARK"}},
		{"no newline", `{"query":"MARK","filterTerms":[{"query":"^tail MARK$","regex":true}]}`, []string{"tail MARK"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := hitTexts(searchLive(t, s, tc.body).hits)
			if !sameSet(got, tc.want) {
				t.Fatalf("got %#v want %#v body=%s", got, tc.want, tc.body)
			}
		})
	}
}

func TestPinLiveFilterInvalidRegexPrompt(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		f, err := os.Create(filepath.Join(root, "big.txt"))
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		w := bufio.NewWriterSize(f, 1<<20)
		line := []byte("g xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n")
		for i := 0; i < 80_000; i++ {
			if _, err := w.Write(line); err != nil {
				t.Fatal(err)
			}
		}
		if err := w.Flush(); err != nil {
			t.Fatal(err)
		}
	})
	start := time.Now()
	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"g","filterTerms":[{"query":"(","regex":true}]}`, nil)
	elapsed := time.Since(start)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	sse := parseLiveSSE(t, rec.Body.String())
	t.Logf("invalid filter elapsed=%s", elapsed)
	if elapsed > 5*time.Second {
		t.Fatalf("invalid filter did not fail promptly: %s", elapsed)
	}
	if sse.errEv == nil {
		t.Fatalf("want ENGINE error, events=%v body=%s", sse.events, rec.Body.String())
	}
	if sse.errEv["code"] != "ENGINE" {
		t.Fatalf("code=%v", sse.errEv["code"])
	}
	msg, _ := sse.errEv["message"].(string)
	if !strings.Contains(msg, "regex parse error") {
		t.Fatalf("message=%q", msg)
	}
}

func TestPinLiveFilterCancelReleasesSlot(t *testing.T) {
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	f, err := os.Create(filepath.Join(root, "big.txt"))
	if err != nil {
		t.Fatal(err)
	}
	w := bufio.NewWriterSize(f, 1<<20)
	line := []byte("g " + strings.Repeat("x", 48) + "\n")
	for i := 0; i < 400_000; i++ {
		if _, err := w.Write(line); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Flush(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 100000, TimeoutMs: 30000, NoIgnore: true,
		MaxConcurrent: config.MaxConcurrentDefault,
	}
	s := newTestServer(cfg, rg.Engine{Bin: bin}, "rg")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8787/api/search",
		strings.NewReader(`{"query":"g","filterTerms":["path"]}`))
	req = req.WithContext(ctx)
	req.Host = "127.0.0.1:8787"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		s.Handler().ServeHTTP(rec, req)
		close(done)
	}()
	deadline := time.Now().Add(8 * time.Second)
	for s.Search.Inflight() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if s.Search.Inflight() == 0 {
		t.Fatal("search finished before it could be cancelled")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		t.Fatal("cancelled search did not return")
	}
	if s.Search.Inflight() != 0 {
		t.Fatalf("slot leaked: %d", s.Search.Inflight())
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if rgProcsIn(root) == 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("rg processes still running in %s", root)
}

func TestPinLiveFilterMtimeAfter(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "old.txt", []byte("hello-needle old\n"))
		writeRel(t, root, "new.txt", []byte("hello-needle keepword\n"))
		writeRel(t, root, "other.txt", []byte("hello-needle plain\n"))
		old := time.Now().Add(-48 * time.Hour)
		if err := os.Chtimes(filepath.Join(root, "old.txt"), old, old); err != nil {
			t.Fatal(err)
		}
	})
	cutoff := time.Now().Add(-2 * time.Hour).UnixMilli()
	nameOnly := fmt.Sprintf(`{"query":"hello-needle","mtimeAfter":%d,"filterTerms":["txt"]}`, cutoff)
	got := hitTexts(searchLive(t, s, nameOnly).hits)
	if len(got) != 0 {
		t.Fatalf("filename token txt must not pass: %v", got)
	}
	content := fmt.Sprintf(`{"query":"hello-needle","mtimeAfter":%d,"filterTerms":["keepword"]}`, cutoff)
	got = hitTexts(searchLive(t, s, content).hits)
	if !sameSet(got, []string{"hello-needle keepword"}) {
		t.Fatalf("mtime+content filter = %v", got)
	}
}

func TestPinLiveFilterProgressEvents(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		line := []byte("hello needle " + strings.Repeat("x", 80) + "\n")
		for i := 0; i < 8; i++ {
			f, err := os.Create(filepath.Join(root, fmt.Sprintf("f%02d.txt", i)))
			if err != nil {
				t.Fatal(err)
			}
			w := bufio.NewWriterSize(f, 1<<20)
			for n := 0; n < 20_000; n++ {
				if _, err := w.Write(line); err != nil {
					t.Fatal(err)
				}
			}
			if err := w.Flush(); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
		}
	})
	// Bump the search timeout; the shared live server defaults to 5s.
	cfg := s.Config()
	cfg.TimeoutMs = 60000
	cfg.MaxResults = 100000
	s.SetConfig(cfg)
	s.Search.SetCfg(cfg)

	start := time.Now()
	sse := searchLive(t, s, `{"query":"needle","filterTerms":["zzzznot-in-file","path","text"]}`)
	t.Logf("progress search elapsed=%s events=%d", time.Since(start), len(sse.progress))
	if len(hitTexts(sse.hits)) != 0 {
		t.Fatalf("filter should drop every line, hits=%v", len(sse.hits))
	}
	if len(sse.progress) < 2 {
		t.Fatalf("want increasing progress events while filtering, got %d elapsed=%s", len(sse.progress), time.Since(start))
	}
	var prev float64
	for i, ev := range sse.progress {
		files, _ := ev["files"].(float64)
		if files <= prev {
			t.Fatalf("progress[%d].files=%v did not increase (prev %v)", i, files, prev)
		}
		prev = files
	}
}

func sameSet(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	g := append([]string(nil), got...)
	w := append([]string(nil), want...)
	slices.Sort(g)
	slices.Sort(w)
	return slices.Equal(g, w)
}

func rgProcsIn(root string) int {
	ents, err := os.ReadDir("/proc")
	if err != nil {
		return -1
	}
	n := 0
	for _, e := range ents {
		pid := e.Name()
		if pid == "" || pid[0] < '0' || pid[0] > '9' {
			continue
		}
		cwd, err := os.Readlink("/proc/" + pid + "/cwd")
		if err != nil || cwd != root {
			continue
		}
		cmd, err := os.ReadFile("/proc/" + pid + "/cmdline")
		if err != nil {
			continue
		}
		if bytes.Contains(cmd, []byte("rg")) {
			n++
		}
	}
	return n
}
