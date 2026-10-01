package rg

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math/rand"
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
	// Lines whose raw length is under 3 bytes used to be skipped: rg holds a
	// still-open stdin until the 3-byte BOM peek fills, so judging before
	// close deadlocks. They have to agree with printf | rg too.
	shorts := shortOracleCases()
	if len(shorts) != 211 {
		t.Fatalf("short oracle cases = %d, want 211", len(shorts))
	}
	for i, tc := range shorts {
		t.Run(fmt.Sprintf("short%03d", i), func(t *testing.T) {
			root := t.TempDir()
			writeRootFile(t, root, "line.txt", tc.line)
			assertFilterAgrees(t, bin, root, tc.line, tc.terms)
		})
	}
}

type oracleCase struct {
	line  []byte
	terms []FilterTerm
}

func assertFilterAgrees(t *testing.T, bin, root string, line []byte, terms []FilterTerm) {
	t.Helper()
	wantPass, wantBad := directAll(bin, ensureNL(line), terms)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var n int
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "^",
		Regex:       true,
		NoIgnore:    true,
		FilterTerms: terms,
	}, func(Match) error { n++; return nil }, nil)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("hung on line %q terms %+v", line, terms)
	}
	if wantBad {
		if err == nil {
			t.Fatalf("direct rg failed, engine passed line %q terms %+v hits=%d", line, terms, n)
		}
		return
	}
	if err != nil {
		t.Fatalf("engine err=%v line %q terms %+v directPass=%v", err, line, terms, wantPass)
	}
	if (n > 0) != wantPass {
		t.Fatalf("line %q terms %+v enginePass=%v directPass=%v hits=%d", line, terms, n > 0, wantPass, n)
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
	pass, bad := directFilterOutcome(bin, line, term)
	if bad {
		t.Fatalf("direct rg (%v) failed on %q", BuildFilterArgv(term), line)
	}
	return pass
}

// lineStartsWithBOM reports a UTF-8 or UTF-16 BOM at the first bytes of a line.
func lineStartsWithBOM(b []byte) bool {
	return bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}) ||
		bytes.HasPrefix(b, []byte{0xFF, 0xFE}) ||
		bytes.HasPrefix(b, []byte{0xFE, 0xFF})
}

// encodingNoneArgv inserts --encoding none in front of "--".
func encodingNoneArgv(argv []string) []string {
	out := make([]string, 0, len(argv)+2)
	if n := len(argv); n >= 2 && argv[n-2] == "--" {
		out = append(out, argv[:n-2]...)
		out = append(out, "--encoding", "none")
		out = append(out, argv[n-2:]...)
		return out
	}
	out = append(out, "--encoding", "none")
	out = append(out, argv...)
	return out
}

// directFilterOutcome reports whether printf-style stdin matches, and whether
// rg itself failed (exit other than 0 or 1).
//
// A line that starts with a BOM is compared with `rg --encoding none`. Default
// `printf line | rg` sniffs a BOM only at the start of that stdin and
// transcodes the line; that is rg's stdin sniff, not the match itself. The
// filter judges the raw bytes of a line the head search already decoded, so
// those lines have to agree with --encoding none. Every other line is compared
// with the default flags, which agree with --encoding none.
func directFilterOutcome(bin string, line []byte, term FilterTerm) (pass, bad bool) {
	argv := BuildFilterArgv(term)
	if lineStartsWithBOM(line) {
		argv = encodingNoneArgv(argv)
	}
	cmd := exec.Command(bin, argv...)
	cmd.Stdin = bytes.NewReader(line)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err == nil {
		return true, false
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) && ee.ExitCode() == 1 {
		return false, false
	}
	return false, true
}

func directAll(bin string, line []byte, terms []FilterTerm) (pass, bad bool) {
	pass = true
	for _, term := range terms {
		ok, failed := directFilterOutcome(bin, line, term)
		if failed {
			return false, true
		}
		if !ok {
			pass = false
		}
	}
	return pass, false
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

// shortOracleCases is the line/term matrix whose file bytes are shorter
// than 3. A previous oracle skipped these because judging before closing
// the filter stdin deadlocks. The generator matches that matrix, including
// the seeded random rows, so the skipped count stays 211.
func shortOracleCases() []oracleCase {
	lines := [][]byte{
		[]byte("\n"),
		[]byte("\r\n"),
		[]byte("\r"),
		[]byte("a\n"),
		[]byte("a"),
		[]byte("great day\r\n"),
		[]byte("great day\n"),
		[]byte("go go go\n"),
		[]byte("nothing here\n"),
		[]byte("foo bar\n"),
		[]byte("foobar\n"),
		[]byte("path-like\n"),
		[]byte("line_number\n"),
		[]byte("submatches\n"),
		[]byte("say \"hi\"\n"),
		[]byte("a\\b\n"),
		[]byte("a\tb\n"),
		[]byte("你好\n"),
		[]byte("你好 world\n"),
		[]byte("你好world\n"),
		[]byte("a😀b\n"),
		[]byte(" \n"),
		[]byte("I\n"),
		[]byte("tail"),
		[]byte("before \xff\xfe MARK\n"),
		{0xff, 0xfe, 'M', 'A', 'R', 'K', '\n'},
		[]byte("a\x00b\n"),
		[]byte("g one\n"),
		[]byte("{\"path\":1}\n"),
	}
	terms := []FilterTerm{
		{Query: "i"},
		{Query: "path"},
		{Query: "line_number"},
		{Query: "text"},
		{Query: "lines"},
		{Query: "submatches"},
		{Query: "g"},
		{Query: "G"},
		{Query: "G", CaseSensitive: true},
		{Query: "foo", WordMatch: true},
		{Query: "foo"},
		{Query: "path", WordMatch: true},
		{Query: "^go", Regex: true},
		{Query: "day$", Regex: true},
		{Query: "^g.*y$", Regex: true},
		{Query: "^$", Regex: true},
		{Query: "^tail$", Regex: true},
		{Query: `\bfoo\b`, Regex: true},
		{Query: "你好"},
		{Query: "你好", WordMatch: true},
		{Query: "😀"},
		{Query: `"hi"`},
		{Query: `a\b`},
		{Query: "a\tb"},
		{Query: "MARK"},
		{Query: "before"},
		{Query: "x"},
		{Query: ".", Regex: true},
		{Query: "g.*y"},
		{Query: "^[", Regex: true},
	}
	var out []oracleCase
	for _, ln := range lines {
		for _, term := range terms {
			out = append(out, oracleCase{line: ln, terms: []FilterTerm{term}})
		}
	}
	long := append(bytes.Repeat([]byte("x"), 70000), '\n')
	long[0] = 'g'
	for _, term := range []FilterTerm{{Query: "g"}, {Query: "x"}, {Query: "^g", Regex: true}, {Query: "ZZZ"}} {
		out = append(out, oracleCase{line: long, terms: []FilterTerm{term}})
	}
	var sixteen []FilterTerm
	for _, c := range "abcdefghijklmnop" {
		sixteen = append(sixteen, FilterTerm{Query: string(c)})
	}
	out = append(out, oracleCase{line: []byte("abcdefghijklmnop\n"), terms: sixteen})
	bad := append([]FilterTerm{}, sixteen...)
	bad[3] = FilterTerm{Query: "ZZZ"}
	out = append(out, oracleCase{line: []byte("abcdefghijklmnop\n"), terms: bad})
	out = append(out, oracleCase{line: []byte("go go go\n"), terms: []FilterTerm{
		{Query: "^go", Regex: true},
		{Query: "go", WordMatch: true},
		{Query: "GO"},
	}})
	out = append(out, oracleCase{line: []byte("Go Go\n"), terms: []FilterTerm{
		{Query: "go"},
		{Query: "Go", CaseSensitive: true},
	}})
	out = append(out, oracleCase{line: []byte("Go Go\n"), terms: []FilterTerm{
		{Query: "go", CaseSensitive: true},
	}})
	rng := rand.New(rand.NewSource(20261001))
	alphabet := []byte("abcXYZ你好😀 \t\"\\$^.\n")
	for i := 0; i < 80; i++ {
		n := 1 + rng.Intn(40)
		buf := make([]byte, n)
		for j := range buf {
			buf[j] = alphabet[rng.Intn(len(alphabet))]
		}
		if rng.Intn(3) == 0 {
			buf = append(buf, '\r')
		}
		if rng.Intn(4) != 0 {
			buf = append(buf, '\n')
		}
		if rng.Intn(12) == 0 {
			buf = append([]byte{0xff, 0xfe}, buf...)
		}
		qlen := 1 + rng.Intn(6)
		q := string(alphabet[:1])
		if n > 0 {
			start := rng.Intn(len(buf))
			end := start + qlen
			if end > len(buf) {
				end = len(buf)
			}
			q = string(buf[start:end])
			q = strings.TrimRight(q, "\r\n")
			if q == "" {
				q = "a"
			}
		}
		term := FilterTerm{Query: q, Regex: rng.Intn(3) == 0, CaseSensitive: rng.Intn(2) == 0, WordMatch: rng.Intn(4) == 0}
		if term.Regex && term.WordMatch {
			term.WordMatch = false
		}
		out = append(out, oracleCase{line: buf, terms: []FilterTerm{term}})
	}
	var short []oracleCase
	for _, tc := range out {
		if len(tc.line) < 3 {
			short = append(short, tc)
		}
	}
	return short
}

func TestFilterShortStdinReturnsBeforeDeadline(t *testing.T) {
	bin := liveBin(t)
	cases := []struct {
		name    string
		body    []byte
		query   string
		regex   bool
		filters []FilterTerm
		text    string // set when a pass must be this single hit text
	}{
		{"g-pass-one", []byte("g\n"), "g", false, []FilterTerm{{Query: "g"}}, "g"},
		{"g-fail-one", []byte("g\n"), "g", false, []FilterTerm{{Query: "zzz"}}, ""},
		{"g-pass-three", []byte("g\n"), "g", false, []FilterTerm{
			{Query: "g"},
			{Query: "g", CaseSensitive: true},
			{Query: ".", Regex: true},
		}, "g"},
		{"g-fail-three", []byte("g\n"), "g", false, []FilterTerm{
			{Query: "g"},
			{Query: "zzz"},
			{Query: "g"},
		}, ""},
		{"empty-pass-one", []byte("\n"), "^$", true, []FilterTerm{{Query: "^$", Regex: true}}, ""},
		{"empty-fail-one", []byte("\n"), "^$", true, []FilterTerm{{Query: "g"}}, ""},
		{"empty-three", []byte("\n"), "^$", true, []FilterTerm{
			{Query: "^$", Regex: true},
			{Query: ".", Regex: true},
			{Query: "g"},
		}, ""},
		{"crlf-one", []byte("\r\n"), "^", true, []FilterTerm{{Query: "^", Regex: true}}, ""},
		{"crlf-fail-one", []byte("\r\n"), "^", true, []FilterTerm{{Query: "g"}}, ""},
		{"crlf-three", []byte("\r\n"), "^", true, []FilterTerm{
			{Query: "^", Regex: true},
			{Query: "$", Regex: true},
			{Query: "g"},
		}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantPass, wantBad := directAll(bin, ensureNL(tc.body), tc.filters)
			if wantBad {
				t.Fatalf("direct rg failed for %s", tc.name)
			}
			root := t.TempDir()
			writeRootFile(t, root, "line.txt", tc.body)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			start := time.Now()
			var texts []string
			err := Engine{Bin: bin}.Search(ctx, Input{
				RootReal:    root,
				RelativeDir: ".",
				Query:       tc.query,
				Regex:       tc.regex,
				NoIgnore:    true,
				FilterTerms: tc.filters,
			}, func(m Match) error {
				texts = append(texts, strings.TrimRight(m.Text, "\r\n"))
				return nil
			}, nil)
			elapsed := time.Since(start)
			if err != nil {
				t.Fatalf("err=%v elapsed=%s", err, elapsed)
			}
			if elapsed > time.Second {
				t.Fatalf("elapsed %s, want under 1s", elapsed)
			}
			gotPass := len(texts) > 0
			if gotPass != wantPass {
				t.Fatalf("engine=%v direct=%v texts=%v", gotPass, wantPass, texts)
			}
			if tc.text != "" && wantPass && strings.Join(texts, "|") != tc.text {
				t.Fatalf("texts=%v want %q", texts, tc.text)
			}
			if !wantPass && len(texts) != 0 {
				t.Fatalf("reject case returned %v", texts)
			}
			if wantPass && len(texts) != 1 {
				t.Fatalf("hits=%d want 1, texts=%v", len(texts), texts)
			}
		})
	}
}

func TestFilterManyShortLinesDoNotHang(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	const n = 100_000
	writeRootFile(t, root, "s.txt", bytes.Repeat([]byte("g\n"), n))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	start := time.Now()
	var hits int
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "NO_SUCH_TERM"}, {Query: "zzz"}, {Query: "qq"}},
	}, func(Match) error { hits++; return nil }, nil)
	elapsed := time.Since(start)
	t.Logf("lines=%d filters=3 elapsed=%s", n, elapsed)
	if err != nil {
		t.Fatal(err)
	}
	if hits != 0 {
		t.Fatalf("hits=%d want 0", hits)
	}
}

// TestFilterUTF16BOMFirstMatchDoesNotHang pins the raw-byte rule for a match
// whose payload starts with a UTF-16 BOM. The file itself starts with "zzz\n",
// so the head rg does not transcode it; the first line fed to the filter is
// "\xff\xfeg\n". That line contains the byte 'g' and is a hit, as are the
// following "g\n" lines. Expecting that count goes red if the filter sniffs
// the BOM (the shared stdin then is not one verdict per line) and also goes
// red if a per-line rg without --encoding none transcodes the BOM line away.
func TestFilterUTF16BOMFirstMatchDoesNotHang(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	const extra = 40
	body := append([]byte("zzz\n\xff\xfeg\n"), bytes.Repeat([]byte("g\n"), extra)...)
	writeRootFile(t, root, "a.txt", body)
	filters := []FilterTerm{{Query: "g"}, {Query: "g", CaseSensitive: true}, {Query: "g"}}
	// The BOM line plus each extra "g\n". "zzz" does not match the query.
	const want = 1 + extra
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	start := time.Now()
	var lines []int
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: filters,
	}, func(m Match) error {
		lines = append(lines, m.Line)
		return nil
	}, nil)
	elapsed := time.Since(start)
	t.Logf("utf16-bom hits=%d want=%d elapsed=%s", len(lines), want, elapsed)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != want {
		t.Fatalf("hits=%d want %d lines=%v", len(lines), want, lines)
	}
	if lines[0] != 2 {
		t.Fatalf("first hit line=%d, want 2 (the raw BOM line)", lines[0])
	}
	if elapsed > time.Second {
		t.Fatalf("elapsed %s, want under 1s", elapsed)
	}
}

// TestFilterBOMRawBytes locks the cases the UTF-16 special path got wrong.
// Expectations are the raw bytes, not default `printf line | rg` (which
// transcodes a line that starts with a BOM).
func TestFilterBOMRawBytes(t *testing.T) {
	bin := liveBin(t)
	cases := []struct {
		name    string
		body    []byte
		query   string
		regex   bool
		filters []FilterTerm
		lines   []int
	}{
		{
			name:    "three-lines-filter-g",
			body:    []byte("g hello\n\xff\xfeg\ng zzz\n"),
			query:   "g",
			filters: []FilterTerm{{Query: "g"}},
			lines:   []int{1, 2, 3},
		},
		{
			name:    "feff-middle-filter-g",
			body:    []byte("g hello\n\xfe\xffg\ng zzz\n"),
			query:   "g",
			filters: []FilterTerm{{Query: "g"}},
			lines:   []int{1, 2, 3},
		},
		{
			name:    "utf8-bom-dot",
			body:    []byte("a\n\xef\xbb\xbf\nb\n"),
			query:   ".",
			regex:   true,
			filters: []FilterTerm{{Query: ".", Regex: true}},
			lines:   []int{1, 2, 3},
		},
		{
			// The UTF-8 BOM line is not empty as raw bytes, so ^$ rejects it
			// and the other non-empty lines.
			name:    "utf8-bom-empty",
			body:    []byte("a\n\xef\xbb\xbf\nb\n"),
			query:   ".",
			regex:   true,
			filters: []FilterTerm{{Query: "^$", Regex: true}},
			lines:   nil,
		},
		{
			name:    "half-bom-still-matches-g",
			body:    []byte("g hello\n\xffg\ng zzz\n"),
			query:   "g",
			filters: []FilterTerm{{Query: "g"}},
			lines:   []int{1, 2, 3},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeRootFile(t, root, "a.txt", tc.body)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			start := time.Now()
			var got []int
			err := Engine{Bin: bin}.Search(ctx, Input{
				RootReal:    root,
				RelativeDir: ".",
				Query:       tc.query,
				Regex:       tc.regex,
				NoIgnore:    true,
				FilterTerms: tc.filters,
			}, func(m Match) error {
				got = append(got, m.Line)
				return nil
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if time.Since(start) > time.Second {
				t.Fatalf("elapsed %s", time.Since(start))
			}
			if len(got) != len(tc.lines) {
				t.Fatalf("lines=%v want %v", got, tc.lines)
			}
			for i := range got {
				if got[i] != tc.lines[i] {
					t.Fatalf("lines=%v want %v", got, tc.lines)
				}
			}
		})
	}
}

// TestFilterBOMOracleUsesEncodingNone compares each fed line with rg.
// BOM-leading lines use --encoding none; every other line uses default
// `printf line | rg`. The file does not itself start with a BOM, so the head
// search does not transcode the whole file.
func TestFilterBOMOracleUsesEncodingNone(t *testing.T) {
	bin := liveBin(t)
	lines := [][]byte{
		[]byte("g hello\n"),
		{0xff, 0xfe, 'g', '\n'},
		[]byte("g zzz\n"),
		{0xfe, 0xff, 'g', '\n'},
		[]byte("plain\n"),
		{0xef, 0xbb, 0xbf, '\n'},
		[]byte("before \xff\xfe after\n"),
		{0xff, 'g', '\n'},
		[]byte("你好\n"),
	}
	var body []byte
	for _, ln := range lines {
		body = append(body, ln...)
	}
	terms := []FilterTerm{
		{Query: "g"},
		{Query: ".", Regex: true},
		{Query: "^$", Regex: true},
		{Query: "你好"},
		{Query: "hello"},
	}
	for _, term := range terms {
		t.Run(term.Query, func(t *testing.T) {
			root := t.TempDir()
			writeRootFile(t, root, "a.txt", body)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			got := map[int]bool{}
			err := Engine{Bin: bin}.Search(ctx, Input{
				RootReal:    root,
				RelativeDir: ".",
				Query:       ".",
				Regex:       true,
				NoIgnore:    true,
				FilterTerms: []FilterTerm{term},
			}, func(m Match) error {
				got[m.Line] = true
				return nil
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			for i, ln := range lines {
				pass, bad := directFilterOutcome(bin, ensureNL(ln), term)
				if bad {
					t.Fatalf("oracle rg failed on line %d %q", i+1, ln)
				}
				if got[i+1] != pass {
					t.Fatalf("line %d %q bom=%v engine=%v oracle=%v", i+1, ln, lineStartsWithBOM(ln), got[i+1], pass)
				}
			}
		})
	}
}

// TestFilterUTF16FileFilteredIsOrderedSubset covers a file whose first bytes
// are a UTF-16 BOM. The head rg transcodes that file; the filter then sees
// the decoded text. Hits with a filter are an ordered subset of the hits
// without one.
func TestFilterUTF16FileFilteredIsOrderedSubset(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "a.txt", utf16LEFile("g hello\nnope\ng zzz\nonly g\n"))
	all := runSearch(t, bin, root, Input{Query: ".", Regex: true})
	filt := runSearch(t, bin, root, Input{
		Query:       ".",
		Regex:       true,
		FilterTerms: []FilterTerm{{Query: "g"}},
	})
	if len(all.texts) == 0 {
		t.Fatal("unfiltered UTF-16 file produced no hits")
	}
	if !orderedTextSubset(all.texts, filt.texts) {
		t.Fatalf("filtered %v is not an ordered subset of %v", filt.texts, all.texts)
	}
	for _, text := range filt.texts {
		if !strings.Contains(strings.ToLower(text), "g") {
			t.Fatalf("filtered hit %q does not contain g", text)
		}
	}
	if len(filt.texts) == len(all.texts) {
		t.Fatal("filter g dropped nothing; the fixture includes a line without g")
	}
}

func utf16LEFile(s string) []byte {
	out := []byte{0xFF, 0xFE}
	for _, r := range s {
		out = append(out, byte(r), byte(r>>8))
	}
	return out
}

func orderedTextSubset(all, sub []string) bool {
	i := 0
	for _, s := range sub {
		found := false
		for i < len(all) {
			if all[i] == s {
				found = true
				i++
				break
			}
			i++
		}
		if !found {
			return false
		}
	}
	return true
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
