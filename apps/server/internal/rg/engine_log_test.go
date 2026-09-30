package rg

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"web-grep/internal/logx"
)

func captureLog(t *testing.T, level string) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	logx.SetOutput(&buf)
	logx.SetLevel(level)
	t.Cleanup(func() {
		logx.SetOutput(nil)
		logx.SetLevel("info")
	})
	return &buf
}

func logRecs(t *testing.T, raw string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line: %v %s", err, line)
		}
		out = append(out, rec)
	}
	return out
}

func recString(rec map[string]any, key string) string {
	s, _ := rec[key].(string)
	return s
}

func recLines(t *testing.T, rec map[string]any) int {
	t.Helper()
	f, ok := rec["lines"].(float64)
	if !ok {
		t.Fatalf("lines missing in %v", rec)
	}
	return int(f)
}

func TestRgCommandFollowsDebugLevel(t *testing.T) {
	query := "fx7-plain-needle"
	root := t.TempDir()
	bin := fakeRg(t, "exit 0\n")
	buf := captureLog(t, "info")
	// Dev mode and an explicit info level used to force an info "rg" line.
	t.Setenv("WEB_GREP_DEV", "1")
	t.Setenv("WEB_GREP_LOG_LEVEL", "info")

	in := Input{RootReal: root, RelativeDir: ".", Query: query, Hidden: true}
	err := Engine{Bin: bin}.Search(context.Background(), in, func(Match) error { return nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(buf.String()) != "" {
		t.Fatalf("info log leaked the rg command:\n%s", buf.String())
	}
	if strings.Contains(buf.String(), root) || strings.Contains(buf.String(), query) {
		t.Fatalf("info log contains cwd or query:\n%s", buf.String())
	}

	buf.Reset()
	logx.SetLevel("debug")
	err = Engine{Bin: bin}.Search(context.Background(), in, func(Match) error { return nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	recs := logRecs(t, buf.String())
	if len(recs) != 1 {
		t.Fatalf("debug records = %d, want 1\n%s", len(recs), buf.String())
	}
	rec := recs[0]
	if recString(rec, "level") != "debug" || recString(rec, "msg") != "rg" {
		t.Fatalf("rg line = level %q msg %q", recString(rec, "level"), recString(rec, "msg"))
	}
	if recString(rec, "cwd") != root {
		t.Fatalf("cwd = %q, want %q", recString(rec, "cwd"), root)
	}
	if !strings.Contains(recString(rec, "cmd"), query) {
		t.Fatalf("cmd missing query: %s", recString(rec, "cmd"))
	}
}

func TestRgStderrWarnDropsPattern(t *testing.T) {
	const query = "fx7-leak-query"
	root := t.TempDir()
	bin := fakeRg(t, `cat >&2 <<'EOF'
rg: regex parse error:
    (?:fx7-leak-query-(?:)
    ^
error: unclosed group
EOF
exit 2
`)
	buf := captureLog(t, "info")
	t.Setenv("WEB_GREP_DEV", "1")
	t.Setenv("WEB_GREP_LOG_LEVEL", "info")
	in := Input{RootReal: root, RelativeDir: ".", Query: query + "-(?:", Regex: true}

	err := Engine{Bin: bin}.Search(context.Background(), in, func(Match) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "regex parse error") || !strings.Contains(err.Error(), query) {
		t.Fatalf("err = %v, want the full rg parse error", err)
	}
	raw := buf.String()
	if strings.Contains(raw, query) || strings.Contains(raw, root) {
		t.Fatalf("info stderr log leaked query or root:\n%s", raw)
	}
	recs := logRecs(t, raw)
	if len(recs) != 1 {
		t.Fatalf("records = %d, want the warn only\n%s", len(recs), raw)
	}
	rec := recs[0]
	if recString(rec, "level") != "warn" || recString(rec, "msg") != "rg stderr" {
		t.Fatalf("record = %v", rec)
	}
	if recString(rec, "stderr") != "rg: regex parse error:" {
		t.Fatalf("stderr = %q", recString(rec, "stderr"))
	}
	if got, want := recLines(t, rec), 4; got != want {
		t.Fatalf("lines = %d, want %d", got, want)
	}

	buf.Reset()
	logx.SetLevel("debug")
	err = Engine{Bin: bin}.Search(context.Background(), in, func(Match) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), query) {
		t.Fatalf("err = %v, want the pattern kept on the returned error", err)
	}
	var warnHead, debugStderr string
	for _, rec := range logRecs(t, buf.String()) {
		switch recString(rec, "msg") {
		case "rg stderr":
			if recString(rec, "level") == "warn" {
				warnHead = recString(rec, "stderr")
			}
			if recString(rec, "level") == "debug" {
				debugStderr = recString(rec, "stderr")
			}
		}
	}
	if warnHead != "rg: regex parse error:" || strings.Contains(warnHead, query) {
		t.Fatalf("warn head = %q", warnHead)
	}
	if !strings.Contains(debugStderr, query) || !strings.Contains(debugStderr, "\n") {
		t.Fatalf("debug stderr = %q", debugStderr)
	}
}

func TestRgStderrWarnStripsRootAndTruncates(t *testing.T) {
	const query = "fx7-leak-query"
	root := t.TempDir()
	line := strings.Repeat("字", 201)
	bin := fakeRg(t, "cat >&2 <<'EOF'\n"+line+"\n"+query+"\nEOF\nexit 2\n")
	buf := captureLog(t, "info")
	err := Engine{Bin: bin}.Search(context.Background(), Input{RootReal: root, RelativeDir: ".", Query: query},
		func(Match) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), query) {
		t.Fatalf("err = %v, want the query kept for the client", err)
	}
	recs := logRecs(t, buf.String())
	if len(recs) != 1 {
		t.Fatalf("records:\n%s", buf.String())
	}
	head := recString(recs[0], "stderr")
	if head != strings.Repeat("字", 200) {
		t.Fatalf("head = %q (%d runes)", head, len([]rune(head)))
	}
	if strings.Contains(buf.String(), query) {
		t.Fatalf("query leaked:\n%s", buf.String())
	}
	if recLines(t, recs[0]) != 2 {
		t.Fatalf("lines = %d", recLines(t, recs[0]))
	}

	buf.Reset()
	rooted := fakeRg(t, "cat >&2 <<'EOF'\nrg: "+root+"/secret.txt: boom\n"+query+"\nEOF\nexit 2\n")
	err = Engine{Bin: rooted}.Search(context.Background(), Input{RootReal: root, RelativeDir: ".", Query: query},
		func(Match) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), root) || !strings.Contains(err.Error(), query) {
		t.Fatalf("err = %v, want the full stderr returned", err)
	}
	recs = logRecs(t, buf.String())
	if len(recs) != 1 {
		t.Fatalf("records:\n%s", buf.String())
	}
	want := "rg: " + filepath.Base(root) + "/secret.txt: boom"
	if recString(recs[0], "stderr") != want {
		t.Fatalf("stderr = %q, want %q", recString(recs[0], "stderr"), want)
	}
	if strings.Contains(buf.String(), root) || strings.Contains(buf.String(), query) {
		t.Fatalf("root or query leaked:\n%s", buf.String())
	}
}

func TestUnreadablePathWarnStaysCountOnly(t *testing.T) {
	query := "fx7-plain-needle"
	root := t.TempDir()
	bin := fakeRg(t, `printf '%s\n' '`+matchLine+`'
echo 'rg: priv/locked.txt: Permission denied (os error 13)' >&2
exit 2
`)
	buf := captureLog(t, "info")
	t.Setenv("WEB_GREP_DEV", "1")
	t.Setenv("WEB_GREP_LOG_LEVEL", "info")
	err := Engine{Bin: bin}.Search(context.Background(), Input{RootReal: root, RelativeDir: ".", Query: query, Hidden: true},
		func(Match) error { return nil }, nil)
	if err != nil {
		t.Fatalf("unreadable paths must not fail the search: %v", err)
	}
	raw := buf.String()
	if strings.Contains(raw, "locked.txt") || strings.Contains(raw, "Permission denied") ||
		strings.Contains(raw, query) || strings.Contains(raw, root) || strings.Contains(raw, `"msg":"rg"`) {
		t.Fatalf("unreadable-path warn leaked detail:\n%s", raw)
	}
	recs := logRecs(t, raw)
	if len(recs) != 1 {
		t.Fatalf("records:\n%s", raw)
	}
	rec := recs[0]
	if recString(rec, "level") != "warn" || recString(rec, "msg") != "rg skipped unreadable paths" {
		t.Fatalf("record = %v", rec)
	}
	stages, ok := rec["stages"].(float64)
	if !ok || int(stages) != 1 {
		t.Fatalf("stages = %v", rec["stages"])
	}
}
