package search

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestListNewerFiles(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "old.log")
	newPath := filepath.Join(root, "new.log")
	hidden := filepath.Join(root, ".hidden.log")
	if err := os.WriteFile(oldPath, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newPath, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hidden, []byte("hid"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	newTime := time.Now().Add(-30 * time.Minute)
	if err := os.Chtimes(oldPath, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newPath, newTime, newTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(hidden, newTime, newTime); err != nil {
		t.Fatal(err)
	}

	got, err := ListNewerFiles(root, ".", time.Now().Add(-2*time.Hour), true, false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(got, "new.log") {
		t.Fatalf("missing new.log: %v", got)
	}
	if slices.Contains(got, "old.log") {
		t.Fatalf("old.log should be excluded: %v", got)
	}
	if !slices.Contains(got, ".hidden.log") {
		t.Fatalf("hidden should be included when hidden=true: %v", got)
	}

	noHidden, err := ListNewerFiles(root, ".", time.Now().Add(-2*time.Hour), false, false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(noHidden, ".hidden.log") {
		t.Fatalf("hidden leaked: %v", noHidden)
	}

	all, err := ListNewerFiles(root, ".", time.Time{}, true, false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(all, "old.log") || !slices.Contains(all, "new.log") {
		t.Fatalf("zero cutoff should list all files: %v", all)
	}

	excluded, err := ListNewerFiles(root, ".", time.Now().Add(-2*time.Hour), true, false, false, []string{"new.log"})
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(excluded, "new.log") {
		t.Fatalf("exclude should drop new.log before mtime: %v", excluded)
	}
	if slices.Contains(excluded, "old.log") {
		t.Fatalf("mtime should still drop old.log: %v", excluded)
	}
}
