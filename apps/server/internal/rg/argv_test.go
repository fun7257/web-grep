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

func TestBuildArgvLimitToListOmitsUserGlobs(t *testing.T) {
	argv, err := BuildArgv(Input{
		RootReal:     "/tmp/root",
		RelativeDir:  ".",
		Query:        "needle",
		LimitToList:  true,
		FileList:     []string{"src/a.ts"},
		GlobInclude:  []string{"*.ts"},
		GlobExclude:  []string{"*.test.ts"},
		AllowSecrets: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(argv, "--glob") {
		t.Fatalf("content rg must not glob; files are preselected: %v", argv)
	}
}

func TestBuildArgvLimitToListUsesRegexpFlagAndNoDir(t *testing.T) {
	argv, err := BuildArgv(Input{
		RootReal:    "/tmp/root",
		RelativeDir: "logs",
		Query:       "needle",
		LimitToList: true,
		FileList:    []string{"logs/a.log"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(argv, "--files-from") {
		t.Fatalf("rg 15 has no --files-from: %v", argv)
	}
	if !slices.Contains(argv, "-e") {
		t.Fatalf("need -e so remaining args are paths: %v", argv)
	}
	if slices.Contains(argv, "logs") {
		t.Fatalf("must not pass RelativeDir when files are pre-filtered: %v", argv)
	}
	if argv[len(argv)-1] != "--" || argv[len(argv)-2] != "needle" {
		t.Fatalf("expected -e needle --, got %v", argv[len(argv)-4:])
	}
}

func TestSplitFileListRespectsBudget(t *testing.T) {
	files := []string{"a.log", "bb.log", "ccc.log"}
	got := splitFileList(files, 8)
	if len(got) < 2 {
		t.Fatalf("expected multiple chunks, got %v", got)
	}
	var flat []string
	for _, c := range got {
		flat = append(flat, c...)
	}
	if !slices.Equal(flat, files) {
		t.Fatalf("lost files: %v", flat)
	}
}

func TestFormatCmdQuotesQuery(t *testing.T) {
	got := formatCmd("/opt/rg", []string{"--json", "--", "a b", "src"})
	if got != "/opt/rg --json -- 'a b' src" {
		t.Fatal(got)
	}
}

func TestBuildFilterArgvPipesLiteralFlags(t *testing.T) {
	got := BuildFilterArgv(AndTerm{Query: "host", WordMatch: true})
	want := []string{"--no-config", "-F", "-i", "-w", "--", "host"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestBuildFilterArgvUsesPerTermModifiers(t *testing.T) {
	got := BuildFilterArgv(AndTerm{Query: "H.llo", Regex: true, CaseSensitive: true})
	want := []string{"--no-config", "-s", "--", "H.llo"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
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
