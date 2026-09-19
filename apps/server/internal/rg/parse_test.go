package rg

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestParseMatchLine(t *testing.T) {
	line := []byte(`{"type":"match","data":{"path":{"text":"a.ts"},"lines":{"text":"hello world\n"},"line_number":3,"submatches":[{"start":0,"end":5}]}}`)
	m, ok := ParseMatchLine(line)
	if !ok || m.Path != "a.ts" || m.Line != 3 || m.Text != "hello world\n" {
		t.Fatalf("%+v %v", m, ok)
	}
	if len(m.Submatches) != 1 || m.Submatches[0] != [2]int{0, 5} {
		t.Fatalf("sub %+v", m.Submatches)
	}
	if _, ok := ParseMatchLine([]byte(`{"type":"begin"}`)); ok {
		t.Fatal("begin is not a match")
	}
}

func TestUtf16OffsetsCJK(t *testing.T) {
	s := "你好"
	// each CJK char is 3 UTF-8 bytes, 1 UTF-16 code unit
	if utf8ByteOffsetToUTF16(s, 3) != 1 {
		t.Fatal(utf8ByteOffsetToUTF16(s, 3))
	}
	if utf8ByteOffsetToUTF16(s, 6) != 2 {
		t.Fatal(utf8ByteOffsetToUTF16(s, 6))
	}
}

func TestParseMatchLineDecodesBytesField(t *testing.T) {
	payload := []byte(`{"type":"match","data":{"path":{"text":"a.log"},"lines":{"bytes":"aGVsbG8gd29ybGQK"},"line_number":2,"submatches":[{"start":0,"end":5}]}}`)
	m, ok := ParseMatchLine(payload)
	if !ok || m.Text != "hello world\n" {
		t.Fatalf("%+v %v", m, ok)
	}
}

func TestToRelativeHitCutsUTF8OnRuneBoundary(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Repeat("你", 30_000) + "\n"
	m := Match{Path: "ok.txt", Line: 1, Text: text}
	hit, ok := ToRelativeHit(root, false, m)
	if !ok {
		t.Fatal("hit")
	}
	if !utf8.ValidString(hit.Text) {
		t.Fatal("truncated text must stay valid utf8")
	}
	if strings.HasSuffix(hit.Text, "\n") {
		t.Fatal("newline should be stripped")
	}
}

func TestParseMatchLineInvalidUTF8BytesReplaces(t *testing.T) {
	raw := []byte("ascii-needle before \xff\xfe after ascii-needle\n")
	payload, err := jsonMatchBytes("badutf.txt", raw, [][2]int{{0, 12}, {29, 41}})
	if err != nil {
		t.Fatal(err)
	}
	m, ok := ParseMatchLine(payload)
	if !ok {
		t.Fatal("rg bytes-field match must parse")
	}
	if !utf8.ValidString(m.Text) {
		t.Fatalf("decoded text must be valid UTF-8: %q", m.Text)
	}
	if !strings.Contains(m.Text, "\uFFFD") {
		t.Fatalf("invalid bytes must become U+FFFD: %q", m.Text)
	}
	if !strings.Contains(m.Text, "ascii-needle") {
		t.Fatalf("ASCII needle must survive replacement: %q", m.Text)
	}
}

func TestToRelativeHitInvalidUTF8DoesNotPanic(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "badutf.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	// Mid-rune offset + invalid prefix: skip that span instead of crashing.
	m := Match{
		Path:       "badutf.txt",
		Line:       1,
		Text:       "ascii-needle before \xff\xfe after ascii-needle\n",
		Submatches: [][2]int{{0, 12}, {21, 22}, {29, 41}},
	}
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("ToRelativeHit panicked on invalid UTF-8: %v", r)
		}
	}()
	hit, ok := ToRelativeHit(root, false, m)
	if !ok {
		t.Fatal("hit")
	}
	if !utf8.ValidString(hit.Text) {
		t.Fatalf("hit text must be valid UTF-8: %q", hit.Text)
	}
	if !strings.Contains(hit.Text, "\uFFFD") {
		t.Fatalf("short invalid line must be replaced: %q", hit.Text)
	}
	for _, sp := range hit.Matches {
		if sp.Start < 0 || sp.End < 0 || sp.Start >= sp.End {
			t.Fatalf("broken span leaked: %+v", hit.Matches)
		}
	}
}

func TestUtf16InvalidPrefixReturnsMinusOne(t *testing.T) {
	if utf8ByteOffsetToUTF16("你好", 1) != -1 {
		t.Fatal("mid-rune offset must not convert")
	}
	if utf8ByteOffsetToUTF16("a\xffb", 2) != -1 {
		t.Fatal("invalid UTF-8 prefix must not convert")
	}
	if utf8ByteOffsetToUTF16("ascii-needle", 12) != 12 {
		t.Fatal("valid ASCII prefix must convert")
	}
}

func jsonMatchBytes(path string, line []byte, subs [][2]int) ([]byte, error) {
	type sub struct {
		Start int `json:"start"`
		End   int `json:"end"`
	}
	ss := make([]sub, 0, len(subs))
	for _, s := range subs {
		ss = append(ss, sub{Start: s[0], End: s[1]})
	}
	raw := struct {
		Type string `json:"type"`
		Data struct {
			Path struct {
				Text string `json:"text"`
			} `json:"path"`
			Lines struct {
				Bytes string `json:"bytes"`
			} `json:"lines"`
			LineNumber int   `json:"line_number"`
			Submatches []sub `json:"submatches"`
		} `json:"data"`
	}{}
	raw.Type = "match"
	raw.Data.Path.Text = path
	raw.Data.Lines.Bytes = base64.StdEncoding.EncodeToString(line)
	raw.Data.LineNumber = 1
	raw.Data.Submatches = ss
	return json.Marshal(raw)
}

func TestToRelativeHitAcceptsDotSlashAndAbsUnderRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	m := Match{Path: "./ok.txt", Line: 1, Text: "hello\n", Submatches: [][2]int{{0, 5}}}
	hit, ok := ToRelativeHit(root, false, m)
	if !ok || hit.Path != "ok.txt" {
		t.Fatalf("dot-slash: %+v %v", hit, ok)
	}
	m.Path = filepath.Join(root, "ok.txt")
	hit, ok = ToRelativeHit(root, false, m)
	if !ok || hit.Path != "ok.txt" {
		t.Fatalf("abs: %+v %v", hit, ok)
	}
}
