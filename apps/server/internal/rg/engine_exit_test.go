package rg

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const matchLine = `{"type":"match","data":{"path":{"text":"a.txt"},"lines":{"text":"hello\n"},"line_number":1,"submatches":[{"start":0,"end":5}]}}`

// fakeRg writes an executable shell script that stands in for rg.
func fakeRg(t *testing.T, body string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script rg stand-in needs a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), "rg")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPartialErrorsOnly(t *testing.T) {
	cases := []struct {
		name   string
		stderr string
		want   bool
	}{
		{"permission denied", "rg: priv/locked.txt: Permission denied (os error 13)\n", true},
		{"several unreadable paths", "rg: a: Permission denied (os error 13)\nrg: b: Too many levels of symbolic links (os error 40)\n", true},
		{"symlink loop", "rg: ./a/loop: File system loop found: ./a/loop points to an ancestor ./a\n", true},
		{"bad regex", "rg: regex parse error:\n    (?:()\n    ^\nerror: unclosed group\n", false},
		{"unknown flag", "error: unexpected argument '--nope' found\n", false},
		{"mixed with a real error", "rg: a: Permission denied (os error 13)\nrg: regex parse error:\n", false},
		{"empty", "", false},
		{"blank lines only", "\n\n", false},
	}
	for _, tc := range cases {
		if got := partialErrorsOnly(tc.stderr); got != tc.want {
			t.Errorf("%s: partialErrorsOnly = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestPartialErrorsOnlyIgnoresTruncatedLastLine(t *testing.T) {
	line := "rg: some/dir/file.txt: Permission denied (os error 13)\n"
	full := strings.Repeat(line, stderrLimit/len(line))
	// Cut mid-line, as limitWriter does once its budget runs out.
	truncated := (full + line)[:stderrLimit]
	if len(truncated) != stderrLimit || strings.HasSuffix(truncated, "\n") {
		t.Fatalf("test setup: want a mid-line cut at %d bytes", stderrLimit)
	}
	if !partialErrorsOnly(truncated) {
		t.Fatal("a capture cut off mid-line must not turn a partial error into a failure")
	}
}

func TestSearchTreatsUnreadablePathsAsComplete(t *testing.T) {
	bin := fakeRg(t, `printf '%s\n' '`+matchLine+`'
echo 'rg: priv/locked.txt: Permission denied (os error 13)' >&2
exit 2
`)
	var got []Match
	err := Engine{Bin: bin}.Search(context.Background(), Input{RootReal: t.TempDir(), RelativeDir: ".", Query: "hello"},
		func(m Match) error { got = append(got, m); return nil }, nil)
	if err != nil {
		t.Fatalf("Search returned %v; unreadable paths alone must not fail the search", err)
	}
	if len(got) != 1 {
		t.Fatalf("matches = %d, want 1", len(got))
	}
}

func TestSearchStillFailsOnRealRgError(t *testing.T) {
	bin := fakeRg(t, `printf 'rg: regex parse error:\n    (?:()\nerror: unclosed group\n' >&2
exit 2
`)
	err := Engine{Bin: bin}.Search(context.Background(), Input{RootReal: t.TempDir(), RelativeDir: ".", Query: "("},
		func(Match) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "regex parse error") {
		t.Fatalf("err = %v, want the rg regex parse error", err)
	}
}

func TestSearchStillFailsWhenErrorsMixWithUnreadablePaths(t *testing.T) {
	bin := fakeRg(t, `echo 'rg: a: Permission denied (os error 13)' >&2
echo 'rg: regex parse error:' >&2
exit 2
`)
	err := Engine{Bin: bin}.Search(context.Background(), Input{RootReal: t.TempDir(), RelativeDir: ".", Query: "x"},
		func(Match) error { return nil }, nil)
	if err == nil {
		t.Fatal("a real error mixed with unreadable-path errors must still fail")
	}
}

// A filter that exits before producing one verdict per fed line must fail the
// search. Treating the short stream as "all passed" or "all dropped" hides a
// broken filter. The stand-in consumes stdin so the failure is the short
// verdict stream, not EPIPE; an off-by-one verdict number is a different error.
func TestFilterEarlyExitFewerResultsIsError(t *testing.T) {
	bin := fakeRg(t, `case "$*" in
*--json*)
  printf '%s\n' '`+matchLine+`' '`+matchLine+`' '`+matchLine+`'
  ;;
*)
  # Empty stdin is the preflight: a real rg exits 1 with no stdout. A
  # non-empty batch gets one verdict for several lines.
  tmp=$(mktemp)
  cat > "$tmp"
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    exit 1
  fi
  rm -f "$tmp"
  printf '%s\n' '1-skip'
  exit 0
  ;;
esac
`)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var n int
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    t.TempDir(),
		RelativeDir: ".",
		Query:       "hello",
		FilterTerms: []FilterTerm{{Query: "hello"}},
	}, func(Match) error { n++; return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "rg filter ended before judging every match") {
		t.Fatalf("err=%v, want rg filter ended before judging every match; emitted %d", err, n)
	}
	if n != 0 {
		t.Fatalf("emitted %d matches from a filter that did not judge them", n)
	}
}

// Head exit 2 that is only an unreadable path stays a warning when filters
// are attached. The filter judges the line text, not the JSON record.
func TestFilterKeepsPartialUnreadableSuccess(t *testing.T) {
	bin := fakeRg(t, `case "$*" in
*--json*)
  printf '%s\n' '`+matchLine+`'
  echo 'rg: priv/locked.txt: Permission denied (os error 13)' >&2
  exit 2
  ;;
*)
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n+1))
    printf '%s:%s\n' "$n" "$line"
  done
  exit 0
  ;;
esac
`)
	var n int
	err := Engine{Bin: bin}.Search(context.Background(), Input{
		RootReal:    t.TempDir(),
		RelativeDir: ".",
		Query:       "hello",
		FilterTerms: []FilterTerm{{Query: "hello"}},
	}, func(Match) error { n++; return nil }, nil)
	if err != nil {
		t.Fatalf("unreadable path plus a live filter must not fail: %v", err)
	}
	if n != 1 {
		t.Fatalf("emitted %d, want 1", n)
	}
}

// A filter that dies right away (invalid regex) used to leave the upstream rg
// blocked on a full pipe forever, because the parent kept the pipe's read end
// open. The search must fail promptly with the filter's error instead.
func TestSearchFailsPromptlyWhenFilterDiesWithBigUpstream(t *testing.T) {
	bin := fakeRg(t, `case "$*" in
*--json*)
  # Far more than a pipe buffer holds.
  yes '`+matchLine+`'
  ;;
*)
  echo 'rg: regex parse error:' >&2
  exit 2
  ;;
esac
`)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	in := Input{
		RootReal:    t.TempDir(),
		RelativeDir: ".",
		Query:       "hello",
		FilterTerms: []FilterTerm{{Query: "(", Regex: true}},
	}
	done := make(chan error, 1)
	go func() {
		done <- Engine{Bin: bin}.Search(ctx, in, func(Match) error { return nil }, nil)
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "regex parse error") {
			t.Fatalf("err = %v, want the filter's regex parse error", err)
		}
	case <-time.After(6 * time.Second):
		cancel()
		t.Fatal("search hung after the filter exited early")
	}
}
