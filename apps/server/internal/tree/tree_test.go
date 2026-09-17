package tree

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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
	listing, err := List(root, "", false, Filter{})
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

func TestListSortsFilesByMtimeDescending(t *testing.T) {
	root := t.TempDir()
	older := filepath.Join(root, "aaa.log")
	newer := filepath.Join(root, "zzz.log")
	if err := os.WriteFile(older, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newer, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	newTime := time.Now().Add(-time.Hour)
	if err := os.Chtimes(older, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newer, newTime, newTime); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := List(root, "", false, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	var files []string
	if len(listing.Entries) == 0 || !listing.Entries[0].Dir || listing.Entries[0].Name != "subdir" {
		t.Fatalf("dirs should stay first: %v", listing.Entries)
	}
	for _, e := range listing.Entries {
		if !e.Dir {
			files = append(files, e.Name)
		}
	}
	if len(files) < 2 || files[0] != "zzz.log" || files[1] != "aaa.log" {
		t.Fatalf("files should be newest first, got %v", files)
	}
}

func TestCountFilesRespectsMtime(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	oldFile := filepath.Join(root, "old.log")
	newFile := filepath.Join(root, "sub", "new.log")
	if err := os.WriteFile(oldFile, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newFile, []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	newTime := time.Now().Add(-time.Hour)
	if err := os.Chtimes(oldFile, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newFile, newTime, newTime); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	all, err := CountFiles(root, "", false, Filter{})
	if err != nil || all != 2 {
		t.Fatalf("all=%d err=%v", all, err)
	}
	recent, err := CountFiles(root, "", false, Filter{After: time.Now().Add(-2 * time.Hour)})
	if err != nil || recent != 1 {
		t.Fatalf("recent=%d err=%v", recent, err)
	}
	sub, err := CountFiles(root, "sub", false, Filter{})
	if err != nil || sub != 1 {
		t.Fatalf("sub=%d err=%v", sub, err)
	}
}

func TestListHidesOldFilesAndEmptyDirs(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "olddir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "newdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	oldFile := filepath.Join(root, "old.log")
	newFile := filepath.Join(root, "new.log")
	nestedOld := filepath.Join(root, "olddir", "a.log")
	nestedNew := filepath.Join(root, "newdir", "b.log")
	for _, p := range []string{oldFile, newFile, nestedOld, nestedNew} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	newTime := time.Now().Add(-30 * time.Minute)
	for _, p := range []string{oldFile, nestedOld} {
		if err := os.Chtimes(p, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{newFile, nestedNew} {
		if err := os.Chtimes(p, newTime, newTime); err != nil {
			t.Fatal(err)
		}
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := List(root, "", false, Filter{After: time.Now().Add(-2 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, e := range listing.Entries {
		got[e.Name] = e.Dir
	}
	if _, ok := got["new.log"]; !ok {
		t.Fatalf("new.log missing: %v", listing.Entries)
	}
	if _, ok := got["old.log"]; ok {
		t.Fatal("old.log should be hidden")
	}
	if _, ok := got["newdir"]; !ok {
		t.Fatal("newdir should stay, it has a recent file")
	}
	if _, ok := got["olddir"]; ok {
		t.Fatal("olddir should be hidden, only old files inside")
	}
}

func TestListFiltersIncludeAndExcludeGlobs(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "keep.ts"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skip.js"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "keep.test.ts"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "app.ts"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := List(root, "", false, Filter{
		Include: []string{"*.ts"},
		Exclude: []string{"*.test.ts"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, e := range listing.Entries {
		got[e.Name] = e.Dir
	}
	if _, ok := got["keep.ts"]; !ok {
		t.Fatal("keep.ts")
	}
	if _, ok := got["src"]; !ok {
		t.Fatal("src dir with matching files")
	}
	if _, ok := got["skip.js"]; ok {
		t.Fatal("skip.js should be excluded by include")
	}
	if _, ok := got["keep.test.ts"]; ok {
		t.Fatal("keep.test.ts should be excluded")
	}
	n, err := CountFiles(root, "", false, Filter{
		Include: []string{"*.ts"},
		Exclude: []string{"*.test.ts"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("count=%d want 2 (keep.ts + src/app.ts)", n)
	}
}

func TestListExcludeBeforeTime(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "keep.ts"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skip.ts"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "old.ts"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(filepath.Join(root, "old.ts"), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := List(root, "", false, Filter{
		After:   time.Now().Add(-2 * time.Hour),
		Exclude: []string{"skip.ts"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, e := range listing.Entries {
		got[e.Name] = e.Dir
	}
	if _, ok := got["keep.ts"]; !ok {
		t.Fatal("keep.ts")
	}
	if _, ok := got["skip.ts"]; ok {
		t.Fatal("exclude should drop skip.ts even when it is new")
	}
	if _, ok := got["old.ts"]; ok {
		t.Fatal("time should drop old.ts after exclude")
	}
}
