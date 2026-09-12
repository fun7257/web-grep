package rg

import (
	"os"
	"path/filepath"
	"testing"
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
