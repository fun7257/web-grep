package preview

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"web-grep/internal/config"
)

func TestDecodeLineCutsUTF8OnRuneBoundary(t *testing.T) {
	truncated := false
	raw := []byte(strings.Repeat("你", 30_000) + "\n")
	got := decodeLine(raw, &truncated)
	if !truncated {
		t.Fatal("expected truncation")
	}
	if !utf8.ValidString(got) {
		t.Fatal("truncated line must stay valid utf8")
	}
}

func TestReadSliceWindows(t *testing.T) {
	root := t.TempDir()
	body := ""
	for i := 1; i <= 50; i++ {
		body += strings.Repeat("x", 3) + "\n"
	}
	if err := os.WriteFile(filepath.Join(root, "big.txt"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{RootReal: root, PreviewLines: 201}
	win, err := ReadSlice(cfg, Query{Path: "big.txt", From: 10, Count: 5})
	if err != nil {
		t.Fatal(err)
	}
	if win.StartLine != 10 || win.LineCount != 5 || win.Eof {
		t.Fatalf("%+v", win)
	}
	if win.Lines[0].N != 10 || win.Lines[4].N != 14 {
		t.Fatalf("lines %+v", win.Lines)
	}
	end, err := ReadSlice(cfg, Query{Path: "big.txt", From: 48, Count: 20})
	if err != nil {
		t.Fatal(err)
	}
	if !end.Eof || end.LineCount != 3 {
		t.Fatalf("eof slice %+v", end)
	}

	mid, err := ReadSlice(cfg, Query{Path: "big.txt", From: 20, Count: 5})
	if err != nil {
		t.Fatal(err)
	}
	if mid.StartLine != 20 || mid.Lines[0].N != 20 {
		t.Fatalf("cursor resume %+v", mid)
	}

	tail, err := ReadSlice(cfg, Query{Path: "big.txt", Count: 5, Tail: true})
	if err != nil {
		t.Fatal(err)
	}
	if !tail.Eof || tail.LineCount != 5 || tail.Lines[0].N != 46 || tail.Lines[4].N != 50 {
		t.Fatalf("tail %+v", tail)
	}
}
