package rg

import (
	"slices"
	"testing"
)

func TestBuildArgvOmitsDotDirAndAddsHidden(t *testing.T) {
	argv, err := BuildArgv(Input{
		RootReal:    "/tmp/root",
		RelativeDir: ".",
		Query:       "needle",
		Hidden:      true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(argv, ".") {
		t.Fatalf("should not pass . as a search path: %v", argv)
	}
	if !slices.Contains(argv, "--hidden") {
		t.Fatalf("missing --hidden: %v", argv)
	}
	if slices.Contains(argv, "--max-columns") {
		t.Fatalf("max-columns should not be set for long log lines: %v", argv)
	}
	if !slices.Contains(argv, "-F") {
		t.Fatalf("literal mode should pass -F: %v", argv)
	}
	if slices.Contains(argv, "--max-count") {
		t.Fatalf("must not cap per-file hits: %v", argv)
	}
}

func TestFormatCmdQuotesQuery(t *testing.T) {
	got := formatCmd("/opt/rg", []string{"--json", "--", "a b", "src"})
	if got != "/opt/rg --json -- 'a b' src" {
		t.Fatal(got)
	}
}

func TestBuildArgvKeepsSubdir(t *testing.T) {
	argv, err := BuildArgv(Input{
		RootReal:    "/tmp/root",
		RelativeDir: "apps/web",
		Query:       "needle",
		Regex:       true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if argv[len(argv)-1] != "apps/web" || argv[len(argv)-2] != "needle" {
		t.Fatalf("expected -- query dir, got %v", argv[len(argv)-4:])
	}
}
