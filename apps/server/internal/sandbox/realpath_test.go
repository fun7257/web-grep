package sandbox

import (
	"os"
	"path/filepath"
	"testing"
)

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRealPathGuardInside(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "root"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(filepath.Join(base, "root"))
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside")
	mustWrite(t, filepath.Join(root, "src", "a.txt"), "in")
	mustWrite(t, filepath.Join(outside, "leak.txt"), "out")
	mustWrite(t, filepath.Join(outside, "sub", "deep.txt"), "out")
	if err := os.Symlink(outside, filepath.Join(root, "link-dir")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "leak.txt"), filepath.Join(root, "link-file")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "src"), filepath.Join(root, "link-in-dir")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "src", "a.txt"), filepath.Join(root, "link-in-file")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "nope"), filepath.Join(root, "broken")); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		rel  string
		want bool
		why  string
	}{
		{"src/a.txt", true, "plain file"},
		{"", true, "root"},
		{"link-in-dir/a.txt", true, "dir symlink that stays inside"},
		{"link-in-file", true, "file symlink that stays inside"},
		{"link-dir/leak.txt", false, "dir symlink to outside"},
		{"link-dir/sub/deep.txt", false, "nested under dir symlink to outside"},
		{"link-file", false, "file symlink to outside"},
		{"broken", false, "broken link"},
		{"src/missing.txt", false, "vanished file"},
	}
	g := NewRealPathGuard(root)
	for _, tc := range cases {
		if got := g.Inside(tc.rel); got != tc.want {
			t.Errorf("Inside(%q) = %v, want %v (%s)", tc.rel, got, tc.want, tc.why)
		}
	}
	// Second pass exercises the directory cache and must agree.
	for _, tc := range cases {
		if got := g.Inside(tc.rel); got != tc.want {
			t.Errorf("cached Inside(%q) = %v, want %v (%s)", tc.rel, got, tc.want, tc.why)
		}
	}
}

func TestRealPathGuardCachesDirectories(t *testing.T) {
	root := t.TempDir()
	root, _ = filepath.EvalSymlinks(root)
	mustWrite(t, filepath.Join(root, "d", "a.txt"), "x")
	mustWrite(t, filepath.Join(root, "d", "b.txt"), "x")
	g := NewRealPathGuard(root)
	if !g.Inside("d/a.txt") || !g.Inside("d/b.txt") {
		t.Fatal("expected both files inside")
	}
	if len(g.dirs) != 1 {
		t.Fatalf("directory cache entries = %d, want 1", len(g.dirs))
	}
}
