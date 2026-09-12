package sandbox

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveUnderRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "a.ts"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("z"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "link-out")); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}

	ok, err := ResolveUnderRoot(root, "ok.txt")
	if err != nil || ok.Rel != "ok.txt" {
		t.Fatalf("ok.txt: %+v %v", ok, err)
	}
	if _, err := ResolveUnderRoot(root, "../etc"); err == nil {
		t.Fatal("expected escape")
	}
	if _, err := ResolveUnderRoot(root, "/etc/passwd"); err == nil {
		t.Fatal("expected absolute")
	}
	if _, err := ResolveUnderRoot(root, "link-out"); err == nil {
		t.Fatal("expected symlink escape")
	}
	if _, err := ResolveUnderRoot(root, "missing"); err == nil {
		t.Fatal("expected missing")
	}
	dot, err := ResolveUnderRoot(root, "")
	if err != nil || dot.Rel != "" {
		t.Fatalf("root: %+v %v", dot, err)
	}
}
