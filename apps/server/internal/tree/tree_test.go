package tree

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListShowsDotConfigButNotSecretsOrJunk(t *testing.T) {
	root := t.TempDir()
	mustWrite := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("ok.txt", "x")
	mustWrite(".gitignore", "node_modules\n")
	mustWrite(".oxlintrc.json", "{}\n")
	mustWrite(".env", "SECRET=1\n")
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := List(root, "", false)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, e := range listing.Entries {
		got[e.Name] = e.Dir
	}
	if _, ok := got["ok.txt"]; !ok {
		t.Fatal("ok.txt")
	}
	if got["ok.txt"] {
		t.Fatal("ok.txt should be a file")
	}
	if _, ok := got[".gitignore"]; !ok {
		t.Fatal(".gitignore should be listed")
	}
	if _, ok := got[".oxlintrc.json"]; !ok {
		t.Fatal(".oxlintrc.json should be listed")
	}
	if _, ok := got["src"]; !ok || !got["src"] {
		t.Fatal("src dir")
	}
	if _, ok := got[".env"]; ok {
		t.Fatal(".env must stay denied")
	}
	if _, ok := got[".git"]; ok {
		t.Fatal(".git must stay skipped")
	}
}

func TestListAgentRootIfPresent(t *testing.T) {
	root := "/Users/fun/agent"
	st, err := os.Stat(root)
	if err != nil || !st.IsDir() {
		t.Skip("agent root not present")
	}
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := List(real, "", false)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]struct{}{}
	for _, e := range listing.Entries {
		names[e.Name] = struct{}{}
	}
	if _, ok := names[".gitignore"]; !ok {
		t.Fatalf("expected .gitignore in %v", listing.Entries)
	}
	if _, ok := names[".oxlintrc.json"]; !ok {
		t.Fatalf("expected .oxlintrc.json in %v", listing.Entries)
	}
	if _, ok := names[".vite"]; ok {
		t.Fatal(".vite should be skipped")
	}
}
