package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"web-grep/internal/config"
	"web-grep/internal/rg"
)

// Step 4 item 5 pins: real-rg edge cases called out as quality debt.
// These go through the production search path (HTTP → argv + piped
// andTerms filters → JSON parse → SSE). Product behavior, andTerms
// contract, SSE names, and HTTP paths are unchanged.

func TestPinLiveRipgrepAndTermsRequireAll(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "keep.txt", []byte(
			`"account":"030680228968","industryType":"4","route":"/trade-users/v1/me","accountHost":"ok"`+"\n",
		))
		// Same query + two of three andTerms — must not hit.
		writeRel(t, root, "partial.txt", []byte(
			`"account":"030680228968","industryType":"4","route":"/trade-users/v1/me"`+"\n",
		))
		// All andTerms, but missing the head query — must not hit.
		writeRel(t, root, "noquery.txt", []byte(
			`"industryType":"4","route":"/trade-users/v1/me","accountHost":"ok"`+"\n",
		))
		// Terms split across lines: pipe AND is per JSON match line.
		writeRel(t, root, "split.txt", []byte(
			`"account":"030680228968","industryType":"4"`+"\n"+
				`"route":"/trade-users/v1/me","accountHost":"ok"`+"\n",
		))
	})

	t.Run("stringTerms", func(t *testing.T) {
		rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
			`{"query":"030680228968","andTerms":["industryType","trade-users","accountHost"]}`, nil)
		assertSearchOK(t, rec)
		_, hits, done := parseSearchSSE(t, rec.Body.String())
		paths := hitPaths(hits)
		if !slices.Contains(paths, "keep.txt") {
			t.Fatalf("all-terms line must hit, got %v body=%s", paths, rec.Body.String())
		}
		for _, leak := range []string{"partial.txt", "noquery.txt", "split.txt"} {
			if slices.Contains(paths, leak) {
				t.Fatalf("andTerms must drop %s (missing a term on the match line): %v", leak, paths)
			}
		}
		if n, _ := done["matchCount"].(float64); n != 1 {
			t.Fatalf("matchCount=%v want 1 done=%v", done["matchCount"], done)
		}
	})

	t.Run("objectTermsOwnModifiers", func(t *testing.T) {
		writeRel(t, s.Config().RootReal, "obj-keep.txt", []byte("Hello world-xyz keep\n"))
		writeRel(t, s.Config().RootReal, "obj-case.txt", []byte("hello world-xyz case\n"))
		writeRel(t, s.Config().RootReal, "obj-and.txt", []byte("Hello missing-regex keep\n"))

		rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
			`{"query":"Hello","caseSensitive":true,"andTerms":[{"query":"world.*","regex":true}]}`, nil)
		assertSearchOK(t, rec)
		_, hits, _ := parseSearchSSE(t, rec.Body.String())
		paths := hitPaths(hits)
		if !slices.Contains(paths, "obj-keep.txt") {
			t.Fatalf("head+andTerm must hit, got %v body=%s", paths, rec.Body.String())
		}
		if slices.Contains(paths, "obj-case.txt") {
			t.Fatalf("case-sensitive head must not hit obj-case.txt: %v", paths)
		}
		if slices.Contains(paths, "obj-and.txt") {
			t.Fatalf("regex andTerm must drop lines without world.*: %v", paths)
		}
	})
}

func TestPinLiveRipgrepExcludeGlobsDropHits(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "keep.txt", []byte("exclude-needle keep\n"))
		writeRel(t, root, "skip.log", []byte("exclude-needle skip-root\n"))
		writeRel(t, root, "nested/deep.log", []byte("exclude-needle skip-nested\n"))
		writeRel(t, root, "nested/keep.txt", []byte("exclude-needle nested-keep\n"))
		writeRel(t, root, "keep.test.ts", []byte("exclude-needle test-file\n"))
	})

	t.Run("starLogDropsAnyLog", func(t *testing.T) {
		rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
			`{"query":"exclude-needle","globExclude":["*.log"]}`, nil)
		assertSearchOK(t, rec)
		_, hits, done := parseSearchSSE(t, rec.Body.String())
		paths := hitPaths(hits)
		for _, want := range []string{"keep.txt", "nested/keep.txt", "keep.test.ts"} {
			if !slices.Contains(paths, want) {
				t.Fatalf("wanted %s, got %v body=%s", want, paths, rec.Body.String())
			}
		}
		for _, leak := range []string{"skip.log", "nested/deep.log"} {
			if slices.Contains(paths, leak) {
				t.Fatalf("*.log exclude leaked %s: %v", leak, paths)
			}
		}
		if n, _ := done["matchCount"].(float64); int(n) != 3 {
			t.Fatalf("matchCount=%v want 3 paths=%v", done["matchCount"], paths)
		}
	})

	t.Run("literalSkipLogIsRootOnly", func(t *testing.T) {
		// Slash-free literals are rooted (tree pick), not a basename match.
		rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
			`{"query":"exclude-needle","globExclude":["skip.log"]}`, nil)
		assertSearchOK(t, rec)
		_, hits, _ := parseSearchSSE(t, rec.Body.String())
		paths := hitPaths(hits)
		if slices.Contains(paths, "skip.log") {
			t.Fatalf("literal exclude must drop root skip.log: %v", paths)
		}
		if !slices.Contains(paths, "nested/deep.log") {
			t.Fatalf("literal skip.log must not exclude nested/deep.log: %v", paths)
		}
	})
}

func TestPinLiveRipgrepInvalidUTF8DoesNotPanic(t *testing.T) {
	s := liveRgServer(t, func(root string) {
		writeRel(t, root, "good.txt", []byte("plain ascii-needle\n"))
		// Invalid UTF-8, no NUL: rg emits lines.bytes; product decodes with U+FFFD.
		writeRel(t, root, "badutf.txt", []byte("ascii-needle before \xff\xfe after ascii-needle\nvalid ascii-needle line\n"))
		// NUL makes rg treat the file as binary when scanning a tree — skip, no error.
		writeRel(t, root, "has-nul.txt", []byte("ascii-needle\x00hidden\n"))
	})

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("search panicked on invalid UTF-8: %v", r)
		}
	}()

	rec := do(t, s.Handler(), "POST", "http://127.0.0.1:8787/api/search",
		`{"query":"ascii-needle"}`, nil)
	assertSearchOK(t, rec)
	events, hits, done := parseSearchSSE(t, rec.Body.String())
	if len(events) == 0 || events[len(events)-1] != "done" {
		t.Fatalf("invalid UTF-8 must finish with done, not error: %v body=%s", events, rec.Body.String())
	}
	if done["cancelled"] == true || done["timedOut"] == true {
		t.Fatalf("unexpected terminal flags: %v", done)
	}

	paths := hitPaths(hits)
	if !slices.Contains(paths, "good.txt") {
		t.Fatalf("valid neighbor must still hit: %v body=%s", paths, rec.Body.String())
	}
	if !slices.Contains(paths, "badutf.txt") {
		t.Fatalf("invalid UTF-8 (no NUL) is searched today: %v body=%s", paths, rec.Body.String())
	}
	if slices.Contains(paths, "has-nul.txt") {
		t.Fatalf("NUL/binary file is skipped by rg tree search, not emitted as an error: %v", paths)
	}

	var sawReplacement bool
	for _, h := range hits {
		text, _ := h["text"].(string)
		if !utf8.ValidString(text) {
			t.Fatalf("hit text must be valid UTF-8: path=%v text=%q", h["path"], text)
		}
		if h["path"] == "badutf.txt" && strings.Contains(text, "\uFFFD") {
			sawReplacement = true
		}
	}
	if !sawReplacement {
		t.Fatalf("invalid-UTF-8 line should surface U+FFFD replacement: hits=%v body=%s", hits, rec.Body.String())
	}
}

func liveRgServer(t *testing.T, setup func(root string)) *Server {
	t.Helper()
	bin := rg.Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	root := t.TempDir()
	if setup != nil {
		setup(root)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		RootReal: root, RootLabel: "t", Host: "127.0.0.1", Port: 8787,
		MaxResults: 10000, TimeoutMs: 5000, NoIgnore: true,
		MaxConcurrent: config.MaxConcurrentDefault,
	}
	return newTestServer(cfg, rg.Engine{Bin: bin}, "rg")
}

func writeRel(t *testing.T, root, rel string, body []byte) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertSearchOK(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
}

func parseSearchSSE(t *testing.T, body string) (events []string, hits []map[string]any, done map[string]any) {
	t.Helper()
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
		events = append(events, name)
		switch name {
		case "hit":
			var hit map[string]any
			if err := json.Unmarshal([]byte(data), &hit); err != nil {
				t.Fatalf("hit json: %v %s", err, data)
			}
			hits = append(hits, hit)
		case "done":
			done = map[string]any{}
			if err := json.Unmarshal([]byte(data), &done); err != nil {
				t.Fatalf("done json: %v %s", err, data)
			}
		case "error":
			t.Fatalf("unexpected error event: %s", data)
		}
	}
	return events, hits, done
}

func hitPaths(hits []map[string]any) []string {
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		if p, ok := h["path"].(string); ok {
			out = append(out, p)
		}
	}
	return out
}
