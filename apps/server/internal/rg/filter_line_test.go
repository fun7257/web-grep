package rg

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func liveBin(t *testing.T) string {
	t.Helper()
	bin := Detect("")
	if bin == "" {
		t.Skip("rg not available")
	}
	return bin
}

func writeRootFile(t *testing.T, root, rel string, body []byte) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
}

type searchOut struct {
	texts    []string
	progress []int
}

func runSearch(t *testing.T, bin, root string, in Input) searchOut {
	t.Helper()
	in.RootReal = root
	if in.RelativeDir == "" {
		in.RelativeDir = "."
	}
	in.NoIgnore = true
	var out searchOut
	err := Engine{Bin: bin}.Search(context.Background(), in, func(m Match) error {
		out.texts = append(out.texts, strings.TrimRight(m.Text, "\r\n"))
		return nil
	}, func(files int) {
		out.progress = append(out.progress, files)
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestFilterJSONFieldNamesDoNotMatchLine(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "c.txt", []byte("go go go\nnothing here\ngreat day\n"))
	// These strings are JSON keys on every match record. They are not all
	// in the line text. "i" is only in "nothing here".
	for _, term := range []string{"path", "line_number", "text", "lines"} {
		got := runSearch(t, bin, root, Input{
			Query:       "g",
			FilterTerms: []FilterTerm{{Query: term}},
		})
		if len(got.texts) != 0 {
			t.Fatalf("filter %q matched line text it is not in: %v", term, got.texts)
		}
	}
	got := runSearch(t, bin, root, Input{
		Query:       "g",
		FilterTerms: []FilterTerm{{Query: "i"}},
	})
	if strings.Join(got.texts, "|") != "nothing here" {
		t.Fatalf("filter i = %v, want only \"nothing here\"", got.texts)
	}
}

func TestFilterFilenameIsNotLineContent(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "uniqname.txt", []byte("hello needle\n"))
	writeRootFile(t, root, "other.txt", []byte("hello uniqname needle\n"))
	miss := runSearch(t, bin, root, Input{
		Query:       "needle",
		FilterTerms: []FilterTerm{{Query: "uniqname"}},
	})
	if len(miss.texts) != 1 || miss.texts[0] != "hello uniqname needle" {
		t.Fatalf("filename-only term must not pass, content term must: %v", miss.texts)
	}
}

func TestFilterAnchorsUseLineContent(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "a.txt", []byte("foo bar\nx foo bar\nxx bar\nbar yy\n"))
	got := runSearch(t, bin, root, Input{
		Query:       "foo",
		FilterTerms: []FilterTerm{{Query: "^foo", Regex: true}},
	})
	if strings.Join(got.texts, "|") != "foo bar" {
		t.Fatalf("^foo = %v", got.texts)
	}
	got = runSearch(t, bin, root, Input{
		Query:       "bar",
		FilterTerms: []FilterTerm{{Query: "bar$", Regex: true}},
	})
	if strings.Join(got.texts, "|") != "foo bar|x foo bar|xx bar" {
		t.Fatalf("bar$ = %v", got.texts)
	}

	crRoot := t.TempDir()
	writeRootFile(t, crRoot, "cr.txt", []byte("great day\r\nfoo bar\r\n"))
	lfRoot := t.TempDir()
	writeRootFile(t, lfRoot, "lf.txt", []byte("great day\nfoo bar\n"))
	for _, tc := range []struct {
		name string
		root string
	}{
		{"crlf", crRoot},
		{"lf", lfRoot},
	} {
		t.Run(tc.name, func(t *testing.T) {
			head := runSearch(t, bin, tc.root, Input{Query: "day$", Regex: true})
			filtered := runSearch(t, bin, tc.root, Input{
				Query:       "day",
				FilterTerms: []FilterTerm{{Query: "day$", Regex: true}},
			})
			if strings.Join(head.texts, "|") != strings.Join(filtered.texts, "|") {
				t.Fatalf("filter day$ = %v, head rg day$ = %v", filtered.texts, head.texts)
			}
		})
	}
}

func TestFilterModifiersDoNotInheritAndAND(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "keep.txt", []byte("Go is here\n"))
	writeRootFile(t, root, "noword.txt", []byte("Go is hereandthere\n"))
	writeRootFile(t, root, "noanchor.txt", []byte("xx Go is here\n"))
	// Head is case-sensitive, whole-word, and a regex. Filters must not
	// inherit that: "go" stays case-insensitive, and only its own flags apply.
	in := Input{
		Query:         "Go",
		Regex:         true,
		CaseSensitive: true,
		WordMatch:     true,
		FilterTerms: []FilterTerm{
			{Query: "go"},
			{Query: "here", WordMatch: true},
			{Query: "^Go", Regex: true},
		},
	}
	got := runSearch(t, bin, root, in)
	if strings.Join(got.texts, "|") != "Go is here" {
		t.Fatalf("AND = %v, want only \"Go is here\"", got.texts)
	}
}

func TestFilterSpecialBytesAndNoTrailingNewline(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "quote.txt", []byte("say \"hi\" MARK\n"))
	writeRootFile(t, root, "bs.txt", []byte("a\\b MARK\n"))
	writeRootFile(t, root, "tab.txt", []byte("a\tb MARK\n"))
	writeRootFile(t, root, "zh.txt", []byte("你好 MARK\n"))
	raw := []byte("before \xff\xfe MARK\n")
	writeRootFile(t, root, "bin.txt", raw)
	writeRootFile(t, root, "tail.txt", []byte("tail MARK"))

	cases := []struct {
		name string
		term FilterTerm
		want string
	}{
		{"quote", FilterTerm{Query: `^say "hi" MARK$`, Regex: true}, "say \"hi\" MARK"},
		{"backslash", FilterTerm{Query: `^a\\b MARK$`, Regex: true}, "a\\b MARK"},
		{"tab", FilterTerm{Query: "^a\tb MARK$", Regex: true}, "a\tb MARK"},
		{"han", FilterTerm{Query: "^你好", Regex: true}, "你好 MARK"},
		{"bytes", FilterTerm{Query: "before"}, "before \uFFFD MARK"},
		{"no newline", FilterTerm{Query: "^tail MARK$", Regex: true}, "tail MARK"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := runSearch(t, bin, root, Input{
				Query:       "MARK",
				FilterTerms: []FilterTerm{tc.term},
			})
			if strings.Join(got.texts, "|") != tc.want {
				t.Fatalf("got %v want %q", got.texts, tc.want)
			}
		})
	}
	// The base64 blob is only in the JSON record, not in the line bytes.
	b64 := base64.StdEncoding.EncodeToString(raw)
	token := b64[:4]
	if bytes.Contains(raw, []byte(token)) {
		t.Fatalf("token %q appears in the raw line", token)
	}
	got := runSearch(t, bin, root, Input{
		Query:       "MARK",
		FilterTerms: []FilterTerm{{Query: token}},
	})
	if len(got.texts) != 0 {
		t.Fatalf("base64 token %q matched line text: %v", token, got.texts)
	}
}

func TestFilterAgreesWithDirectRg(t *testing.T) {
	bin := liveBin(t)
	cases := []struct {
		line []byte
		term FilterTerm
	}{
		{[]byte("Go bar\n"), FilterTerm{Query: "go"}},
		{[]byte("Go bar\n"), FilterTerm{Query: "go", CaseSensitive: true}},
		{[]byte("foo bar\n"), FilterTerm{Query: "foo", WordMatch: true}},
		{[]byte("foobar\n"), FilterTerm{Query: "foo", WordMatch: true}},
		{[]byte("foo bar\n"), FilterTerm{Query: "^foo", Regex: true}},
		{[]byte("xx bar\n"), FilterTerm{Query: "bar$", Regex: true}},
		{[]byte("bar yy\n"), FilterTerm{Query: "bar$", Regex: true}},
		{[]byte("great day\r\n"), FilterTerm{Query: "day$", Regex: true}},
		{[]byte("great day\n"), FilterTerm{Query: "day$", Regex: true}},
		{[]byte("say \"hi\"\n"), FilterTerm{Query: "\""}},
		{[]byte("a\\b\n"), FilterTerm{Query: `a\\b`, Regex: true}},
		{[]byte("a\tb\n"), FilterTerm{Query: "a\tb", Regex: true}},
		{[]byte("你好\n"), FilterTerm{Query: "你好"}},
		{[]byte("before \xff\xfe after\n"), FilterTerm{Query: "before"}},
		{[]byte("tail"), FilterTerm{Query: "^tail$", Regex: true}},
		{[]byte("NOTHING\n"), FilterTerm{Query: "nothing"}},
		{[]byte("path-like\n"), FilterTerm{Query: "path", WordMatch: true}},
	}
	for i, tc := range cases {
		t.Run(fmt.Sprintf("%02d", i), func(t *testing.T) {
			want := directRgMatch(t, bin, ensureNL(tc.line), tc.term)
			root := t.TempDir()
			writeRootFile(t, root, "line.txt", tc.line)
			got := runSearch(t, bin, root, Input{
				Query:       "^",
				Regex:       true,
				FilterTerms: []FilterTerm{tc.term},
			})
			passed := len(got.texts) > 0
			if passed != want {
				t.Fatalf("line %q term %+v engine=%v direct=%v texts=%v", tc.line, tc.term, passed, want, got.texts)
			}
		})
	}
}

func ensureNL(line []byte) []byte {
	if len(line) > 0 && line[len(line)-1] == '\n' {
		return line
	}
	out := make([]byte, len(line)+1)
	copy(out, line)
	out[len(line)] = '\n'
	return out
}

func directRgMatch(t *testing.T, bin string, line []byte, term FilterTerm) bool {
	t.Helper()
	cmd := exec.Command(bin, BuildFilterArgv(term)...)
	cmd.Stdin = bytes.NewReader(line)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err == nil {
		return true
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) && ee.ExitCode() == 1 {
		return false
	}
	t.Fatalf("direct rg (%v): %v stderr=%s", BuildFilterArgv(term), err, stderr.Bytes())
	return false
}

func TestFilterProgressIgnoresFilterTerms(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	for _, name := range []string{"a.txt", "b.txt", "c.txt"} {
		writeRootFile(t, root, name, []byte("hello needle\n"))
	}
	got := runSearch(t, bin, root, Input{
		Query:       "needle",
		FilterTerms: []FilterTerm{{Query: "zzzznot-in-file"}},
	})
	if len(got.texts) != 0 {
		t.Fatalf("filter should drop every line, got %v", got.texts)
	}
	if len(got.progress) != 3 || got.progress[0] != 1 || got.progress[1] != 2 || got.progress[2] != 3 {
		t.Fatalf("progress = %v, want 1,2,3 (begin lines are not filtered)", got.progress)
	}
}

func TestFilterLimitToListSeenDoesNotReset(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	const n = 600
	pad := strings.Repeat("p", 180)
	files := make([]string, 0, n)
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("%s-%04d.txt", pad, i)
		writeRootFile(t, root, name, []byte("hitme\n"))
		files = append(files, name)
	}
	got := runSearch(t, bin, root, Input{
		Query:       "hitme",
		LimitToList: true,
		FileList:    files,
		FilterTerms: []FilterTerm{{Query: "zzzznotHere"}},
	})
	if len(got.texts) != 0 {
		t.Fatalf("expected no hits, got %d", len(got.texts))
	}
	if len(got.progress) != n {
		t.Fatalf("progress events = %d, want %d (seen must span file-list chunks)", len(got.progress), n)
	}
	for i, v := range got.progress {
		if v != i+1 {
			t.Fatalf("progress[%d]=%d, want %d (chunk reset?)", i, v, i+1)
		}
	}
}

func TestFilterManyHitsBoundedMemory(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	const lines = 50_000
	const width = 2048
	body := make([]byte, 0, lines*(width+2))
	prefix := []byte("g ")
	pad := bytes.Repeat([]byte("x"), width-len(prefix))
	for i := 0; i < lines; i++ {
		body = append(body, prefix...)
		body = append(body, pad...)
		body = append(body, '\n')
	}
	// One real line contains the JSON field names; the long lines do not.
	body = append(body, []byte("g path text line_number\n")...)
	writeRootFile(t, root, "big.txt", body)
	body = nil
	runtime.GC()

	// path/text/line_number sit on every JSON record and on one real line.
	for _, tc := range []struct {
		name    string
		filters []FilterTerm
	}{
		{"one", []FilterTerm{{Query: "path"}}},
		{"three", []FilterTerm{{Query: "path"}, {Query: "text"}, {Query: "line_number"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var peak atomic.Uint64
			stop := make(chan struct{})
			go func() {
				var m runtime.MemStats
				tick := time.NewTicker(20 * time.Millisecond)
				defer tick.Stop()
				for {
					select {
					case <-stop:
						return
					case <-tick.C:
						runtime.ReadMemStats(&m)
						for {
							old := peak.Load()
							if m.HeapAlloc <= old || peak.CompareAndSwap(old, m.HeapAlloc) {
								break
							}
						}
					}
				}
			}()
			start := time.Now()
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			var n int
			err := Engine{Bin: bin}.Search(ctx, Input{
				RootReal:    root,
				RelativeDir: ".",
				Query:       "g",
				NoIgnore:    true,
				FilterTerms: tc.filters,
			}, func(Match) error { n++; return nil }, nil)
			elapsed := time.Since(start)
			close(stop)
			if err != nil {
				t.Fatal(err)
			}
			if n != 1 {
				t.Fatalf("hits=%d want 1 (the line that actually contains the term)", n)
			}
			t.Logf("lines=%d filters=%d elapsed=%s peakHeap=%d", lines+1, len(tc.filters), elapsed, peak.Load())
			const ceil = 128 << 20
			if peak.Load() > ceil {
				t.Fatalf("peak HeapAlloc %d exceeds %d (in-flight matches look unbounded)", peak.Load(), ceil)
			}
		})
	}
}

func TestParsePassthruPrefix(t *testing.T) {
	cases := []struct {
		in       string
		n        int
		pass, ok bool
	}{
		{"1:hello", 1, true, true},
		{"12-nope", 12, false, true},
		{"3:time 1:2", 3, true, true},
		{"", 0, false, false},
		{":no", 0, false, false},
		{"9", 0, false, false},
		{"4xrest", 0, false, false},
	}
	for _, tc := range cases {
		n, pass, ok := parsePassthruPrefix([]byte(tc.in))
		if n != tc.n || pass != tc.pass || ok != tc.ok {
			t.Fatalf("%q -> %d %v %v, want %d %v %v", tc.in, n, pass, ok, tc.n, tc.pass, tc.ok)
		}
	}
}
