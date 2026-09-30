package search

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"web-grep/internal/logx"
	"web-grep/internal/rg"
)

type errStream struct {
	mu     sync.Mutex
	events []string
	code   string
	errMsg string
}

func (s *errStream) Event(name string, data any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, name)
	if name != "error" {
		return nil
	}
	m, ok := data.(map[string]any)
	if !ok {
		return nil
	}
	s.code, _ = m["code"].(string)
	s.errMsg, _ = m["message"].(string)
	return nil
}

func (s *errStream) Ping()         {}
func (s *errStream) Flush() error  { return nil }
func (s *errStream) Aborted() bool { return false }

func (s *errStream) snapshot() (events []string, code, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	events = append([]string(nil), s.events...)
	return events, s.code, s.errMsg
}

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

func stderrLineCount(text string) int {
	text = strings.TrimRight(text, "\n")
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n") + 1
}

// mustRg returns a ripgrep binary for the logging tests. CI often has no
// PATH entry named rg; Detect also finds the optional @vscode/ripgrep copy
// installed with the repo. When neither is present, a shell stand-in still
// drives Engine.run so the command and stderr redaction checks run.
func mustRg(t *testing.T) string {
	t.Helper()
	if bin := rg.Detect(""); bin != "" {
		return bin
	}
	if runtime.GOOS == "windows" {
		t.Skip("no rg on PATH or via @vscode/ripgrep, and the shell stand-in needs a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), "rg")
	const body = `#!/bin/sh
case "$*" in
*fx7-leak-query*)
  printf '%s\n' 'rg: regex parse error:' '    (?:fx7-leak-query-(?:)' '    ^' 'error: unclosed group' >&2
  exit 2
  ;;
esac
exit 0
`
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func runSearch(t *testing.T, svc *Service, req Request) *errStream {
	t.Helper()
	pre := svc.Preflight(req)
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	st := &errStream{}
	svc.Run(context.Background(), pre, st)
	return st
}

func TestInfoSearchHidesCommandAndPattern(t *testing.T) {
	rgBin := mustRg(t)
	buf := captureLog(t, "info")
	t.Setenv("WEB_GREP_DEV", "1")
	t.Setenv("WEB_GREP_LOG_LEVEL", "info")

	svc := testService(t, rg.Engine{Bin: rgBin}, 2, 0)
	cfg := svc.Snapshot()
	if err := os.WriteFile(filepath.Join(cfg.RootReal, "note.txt"), []byte("fx7-plain-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	plain := runSearch(t, svc, Request{Query: "fx7-plain-needle", Hidden: true})
	events, _, msg := plain.snapshot()
	if msg != "" {
		t.Fatalf("plain search error: %s", msg)
	}
	if len(events) == 0 || events[len(events)-1] != "done" {
		t.Fatalf("events %v", events)
	}
	if strings.Contains(buf.String(), cfg.RootReal) || strings.Contains(buf.String(), "fx7-plain-needle") || strings.Contains(buf.String(), `"msg":"rg"`) {
		t.Fatalf("info log leaked cwd, query, or rg command:\n%s", buf.String())
	}

	buf.Reset()
	const query = "fx7-leak-query-(?:"
	bad := runSearch(t, svc, Request{Query: query, Regex: true, Hidden: true})
	_, code, errMsg := bad.snapshot()
	if code != "ENGINE" || !strings.Contains(errMsg, "regex parse error") || !strings.Contains(errMsg, "fx7-leak-query") {
		t.Fatalf("sse code=%s message=%q", code, errMsg)
	}
	raw := buf.String()
	if strings.Contains(raw, "fx7-leak-query") || strings.Contains(raw, cfg.RootReal) || strings.Contains(raw, `"msg":"rg"`) {
		t.Fatalf("info failure log leaked:\n%s", raw)
	}
	wantLines := stderrLineCount(errMsg)
	first, _, _ := strings.Cut(strings.TrimRight(errMsg, "\n"), "\n")
	sawWarn, sawErr := false, false
	for _, rec := range logRecs(t, raw) {
		if recString(rec, "level") == "debug" {
			t.Fatalf("debug line at info:\n%s", raw)
		}
		switch recString(rec, "msg") {
		case "rg stderr":
			sawWarn = true
			if recString(rec, "level") != "warn" || recString(rec, "stderr") != first {
				t.Fatalf("rg stderr = %v", rec)
			}
			if recLines(t, rec) != wantLines {
				t.Fatalf("warn lines = %d, want %d", recLines(t, rec), wantLines)
			}
		case "search failed":
			sawErr = true
			if recString(rec, "level") != "error" || recString(rec, "err") != first || recString(rec, "code") != "ENGINE" {
				t.Fatalf("search failed = %v", rec)
			}
			if recLines(t, rec) != wantLines {
				t.Fatalf("error lines = %d, want %d", recLines(t, rec), wantLines)
			}
		}
	}
	if !sawWarn || !sawErr {
		t.Fatalf("missing warn/error in\n%s", raw)
	}
}

func TestDebugSearchLogsCommandButNotPatternOnWarn(t *testing.T) {
	rgBin := mustRg(t)
	buf := captureLog(t, "debug")
	t.Setenv("WEB_GREP_DEV", "")
	t.Setenv("WEB_GREP_LOG_LEVEL", "")

	svc := testService(t, rg.Engine{Bin: rgBin}, 2, 0)
	cfg := svc.Snapshot()
	if err := os.WriteFile(filepath.Join(cfg.RootReal, "note.txt"), []byte("fx7-plain-needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runSearch(t, svc, Request{Query: "fx7-plain-needle", Hidden: true})
	sawCmd := false
	for _, rec := range logRecs(t, buf.String()) {
		if recString(rec, "msg") != "rg" {
			continue
		}
		if recString(rec, "level") != "debug" {
			t.Fatalf("rg level = %q, want debug\n%s", recString(rec, "level"), buf.String())
		}
		if recString(rec, "cwd") != cfg.RootReal {
			t.Fatalf("cwd = %q, want %q", recString(rec, "cwd"), cfg.RootReal)
		}
		if !strings.Contains(recString(rec, "cmd"), "fx7-plain-needle") {
			t.Fatalf("cmd missing query: %s", recString(rec, "cmd"))
		}
		sawCmd = true
	}
	if !sawCmd {
		t.Fatalf("debug log missing rg command:\n%s", buf.String())
	}

	buf.Reset()
	const query = "fx7-leak-query-(?:"
	bad := runSearch(t, svc, Request{Query: query, Regex: true, Hidden: true})
	_, code, errMsg := bad.snapshot()
	if code != "ENGINE" || !strings.Contains(errMsg, "regex parse error") || !strings.Contains(errMsg, "fx7-leak-query") {
		t.Fatalf("sse code=%s message=%q", code, errMsg)
	}
	var warnHead, errHead, debugStderr, debugErr string
	for _, rec := range logRecs(t, buf.String()) {
		msg := recString(rec, "msg")
		lv := recString(rec, "level")
		switch {
		case msg == "rg stderr" && lv == "warn":
			warnHead = recString(rec, "stderr")
		case msg == "rg stderr" && lv == "debug":
			debugStderr = recString(rec, "stderr")
		case msg == "search failed" && lv == "error":
			errHead = recString(rec, "err")
		case msg == "search failed" && lv == "debug":
			debugErr = recString(rec, "err")
		}
	}
	if warnHead != "rg: regex parse error:" || strings.Contains(warnHead, "fx7-leak-query") {
		t.Fatalf("warn head = %q", warnHead)
	}
	if errHead != "rg: regex parse error:" || strings.Contains(errHead, "fx7-leak-query") {
		t.Fatalf("error head = %q", errHead)
	}
	if !strings.Contains(debugStderr, "fx7-leak-query") || !strings.Contains(debugStderr, "\n") {
		t.Fatalf("debug rg stderr = %q", debugStderr)
	}
	if !strings.Contains(debugErr, "fx7-leak-query") {
		t.Fatalf("debug search failed = %q", debugErr)
	}
}

func TestSearchFailedSummaryDropsQueryAndRoot(t *testing.T) {
	buf := captureLog(t, "info")
	svc := testService(t, errEngine{err: errors.New("unset")}, 2, 0)
	cfg := svc.Snapshot()
	const query = "fx7-leak-query"
	full := fmt.Sprintf("open %s/hidden: boom\n    %s\nerror: unclosed group", cfg.RootReal, query)
	svc.Engine = errEngine{err: errors.New(full)}

	st := runSearch(t, svc, Request{Query: query, Regex: true, Hidden: true})
	_, code, errMsg := st.snapshot()
	if code != "ENGINE" || errMsg != full {
		t.Fatalf("sse code=%s message=%q, want the full error", code, errMsg)
	}
	raw := buf.String()
	if strings.Contains(raw, query) || strings.Contains(raw, cfg.RootReal) {
		t.Fatalf("error log leaked query or root:\n%s", raw)
	}
	recs := logRecs(t, raw)
	if len(recs) != 1 {
		t.Fatalf("records:\n%s", raw)
	}
	rec := recs[0]
	want := "open " + cfg.RootLabel + "/hidden: boom"
	if recString(rec, "level") != "error" || recString(rec, "msg") != "search failed" || recString(rec, "err") != want {
		t.Fatalf("record = %v, want err %q", rec, want)
	}
	if recLines(t, rec) != 3 || recString(rec, "code") != "ENGINE" {
		t.Fatalf("record = %v", rec)
	}
}

func TestFileListFailureLogStripsRoot(t *testing.T) {
	buf := captureLog(t, "info")
	svc := testService(t, errEngine{err: errors.New("engine should not run")}, 2, 0)
	cfg := svc.Snapshot()
	orig := listNewerFiles
	t.Cleanup(func() { listNewerFiles = orig })
	listNewerFiles = func(_ context.Context, rootReal, _ string, _ time.Time, _, _, _ bool, _ []string) ([]string, error) {
		return nil, fmt.Errorf("open %s/nope: permission denied", rootReal)
	}

	st := runSearch(t, svc, Request{Query: "fx7-plain-needle", Hidden: true, MtimeAfter: time.Now().Add(-time.Hour)})
	_, code, errMsg := st.snapshot()
	if code != "ENGINE" || !strings.Contains(errMsg, cfg.RootReal) {
		t.Fatalf("sse code=%s message=%q, want the path kept for the client", code, errMsg)
	}
	raw := buf.String()
	if strings.Contains(raw, cfg.RootReal) {
		t.Fatalf("file list log contains the root:\n%s", raw)
	}
	recs := logRecs(t, raw)
	if len(recs) != 1 {
		t.Fatalf("records:\n%s", raw)
	}
	want := "open " + cfg.RootLabel + "/nope: permission denied"
	rec := recs[0]
	if recString(rec, "msg") != "file list failed" || recString(rec, "level") != "error" || recString(rec, "err") != want {
		t.Fatalf("record = %v, want %q", rec, want)
	}
	if _, ok := rec["code"]; ok {
		t.Fatalf("file list log should not invent a code: %v", rec)
	}
}
