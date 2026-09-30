package rg

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"web-grep/internal/logx"
)

type Engine struct {
	Bin string
}

func (e Engine) Kind() string { return "rg" }

const fileListArgBudget = 96 * 1024

func filterArgvs(in Input) [][]string {
	var out [][]string
	for _, term := range in.FilterTerms {
		query := strings.TrimSpace(term.Query)
		if query == "" {
			continue
		}
		term.Query = query
		out = append(out, BuildFilterArgv(term))
	}
	return out
}

func (e Engine) Search(ctx context.Context, in Input, emit func(Match) error, progress func(files int)) error {
	filters := filterArgvs(in)
	if in.LimitToList {
		if len(in.FileList) == 0 {
			return nil
		}
		seen := 0
		for _, chunk := range splitFileList(in.FileList, fileListArgBudget) {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			argv, err := BuildArgv(in)
			if err != nil {
				return err
			}
			argv = append(argv, chunk...)
			n, err := e.run(ctx, in.RootReal, argv, filters, emit, progress, seen)
			if err != nil {
				return err
			}
			seen = n
		}
		return nil
	}
	argv, err := BuildArgv(in)
	if err != nil {
		return err
	}
	_, err = e.run(ctx, in.RootReal, argv, filters, emit, progress, 0)
	return err
}

func splitFileList(files []string, budget int) [][]string {
	if budget <= 0 {
		budget = fileListArgBudget
	}
	var out [][]string
	var chunk []string
	used := 0
	for _, f := range files {
		need := len(f) + 1
		if len(chunk) > 0 && used+need > budget {
			out = append(out, chunk)
			chunk = nil
			used = 0
		}
		chunk = append(chunk, f)
		used += need
	}
	if len(chunk) > 0 {
		out = append(out, chunk)
	}
	return out
}

func (e Engine) run(ctx context.Context, dir string, argv []string, filters [][]string, emit func(Match) error, progress func(files int), filesAlready int) (int, error) {
	cmds := make([]*exec.Cmd, 0, 1+len(filters))
	// readers[i] is the read end of cmds[i]'s stdout. Every one but the last
	// is handed to the next stage as its stdin.
	var readers []io.ReadCloser
	head := exec.Command(e.Bin, argv...)
	head.Dir = dir
	head.Env = Env()
	setProcAttr(head)
	stdout, err := head.StdoutPipe()
	if err != nil {
		return filesAlready, err
	}
	cmds = append(cmds, head)
	readers = append(readers, stdout)
	prev := stdout
	for _, filter := range filters {
		next := exec.Command(e.Bin, filter...)
		next.Dir = dir
		next.Env = Env()
		setProcAttr(next)
		next.Stdin = prev
		out, err := next.StdoutPipe()
		if err != nil {
			return filesAlready, err
		}
		cmds = append(cmds, next)
		readers = append(readers, out)
		prev = out
	}
	stderrs := make([]strings.Builder, len(cmds))
	for i, cmd := range cmds {
		cmd.Stderr = &limitWriter{w: &stderrs[i], n: stderrLimit}
	}
	if logCmd() {
		cmd := formatCmd(e.Bin, argv)
		for _, filter := range filters {
			cmd += " | " + formatCmd(e.Bin, filter)
		}
		logx.Info("rg", map[string]any{"cwd": dir, "cmd": cmd})
	}
	for i, cmd := range cmds {
		if err := cmd.Start(); err != nil {
			terminateAll(cmds[:i])
			return filesAlready, err
		}
	}
	// The children now hold their own copies of the pipes between stages.
	// Keeping ours open would stop an upstream rg from ever seeing EPIPE when
	// a downstream one exits early (e.g. an invalid filter regex), so it would
	// block on a full pipe and Wait below would never return.
	for _, r := range readers[:len(readers)-1] {
		_ = r.Close()
	}

	stopWatch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			terminateAll(cmds)
		case <-stopWatch:
		}
	}()

	sc := bufio.NewScanner(prev)
	// rg JSON includes the whole line; 1MiB dropped long log matches.
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	var emitErr error
	files := filesAlready
	for sc.Scan() {
		if ctx.Err() != nil {
			break
		}
		line := sc.Bytes()
		if IsBeginLine(line) {
			files++
			if progress != nil {
				progress(files)
			}
			continue
		}
		m, ok := ParseMatchLine(line)
		if !ok {
			continue
		}
		if err := emit(m); err != nil {
			emitErr = err
			terminateAll(cmds)
			break
		}
	}
	scanErr := sc.Err()
	var waitErr error
	partial := 0
	for i := len(cmds) - 1; i >= 0; i-- {
		err := cmds[i].Wait()
		if err == nil || benignRgExit(err) {
			continue
		}
		if partialRgExit(err, stderrs[i].String()) {
			partial++
			continue
		}
		if waitErr == nil {
			waitErr = err
		}
	}
	close(stopWatch)
	if partial > 0 && waitErr == nil {
		logx.Warn("rg skipped unreadable paths", map[string]any{"stages": partial})
	}

	if emitErr != nil {
		return files, emitErr
	}
	if ctx.Err() != nil {
		return files, ctx.Err()
	}
	if waitErr != nil {
		msg := ""
		for i := range stderrs {
			part := strings.TrimSpace(stderrs[i].String())
			if part != "" {
				if msg != "" {
					msg += "; "
				}
				msg += part
			}
		}
		if msg != "" {
			logx.Warn("rg stderr", map[string]any{"stderr": msg})
			return files, fmt.Errorf("%s", msg)
		}
		return files, waitErr
	}
	if isClosedPipe(scanErr) {
		return files, nil
	}
	return files, scanErr
}

func terminateAll(cmds []*exec.Cmd) {
	for i := len(cmds) - 1; i >= 0; i-- {
		terminate(cmds[i])
	}
}

// stderrLimit caps how much of each rg stderr is kept.
const stderrLimit = 4096

// partialRgExit reports whether err is rg's exit status 2 caused only by
// paths it could not read (permission denied, symlink loops, ...). rg exits 2
// in that case even though it searched everything else and printed its
// matches, so the search is complete and must not be reported as an engine
// failure. Any other status-2 cause (bad regex, bad flag) is a real error.
func partialRgExit(err error, stderr string) bool {
	var ee *exec.ExitError
	if !errors.As(err, &ee) || ee.ExitCode() != 2 {
		return false
	}
	return partialErrorsOnly(stderr)
}

func partialErrorsOnly(stderr string) bool {
	lines := strings.Split(stderr, "\n")
	if len(stderr) >= stderrLimit && len(lines) > 0 {
		// The capture stopped mid-line; the last line is incomplete.
		lines = lines[:len(lines)-1]
	}
	seen := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		seen = true
		if !strings.HasPrefix(line, "rg: ") {
			return false
		}
		if strings.Contains(line, "(os error ") || strings.Contains(line, "File system loop found") {
			continue
		}
		return false
	}
	return seen
}

func benignRgExit(err error) bool {
	var ee *exec.ExitError
	if !errors.As(err, &ee) {
		return false
	}
	switch ee.ExitCode() {
	case 1, 141:
		return true
	default:
		return false
	}
}

func logCmd() bool {
	switch os.Getenv("WEB_GREP_DEV") {
	case "1", "true", "TRUE":
		return true
	}
	return os.Getenv("WEB_GREP_LOG_LEVEL") == "debug"
}

func formatCmd(bin string, argv []string) string {
	parts := make([]string, 0, 1+len(argv))
	parts = append(parts, shellEscape(bin))
	for _, a := range argv {
		parts = append(parts, shellEscape(a))
	}
	return strings.Join(parts, " ")
}

func shellEscape(s string) string {
	if s == "" {
		return "''"
	}
	if strconv.CanBackquote(s) && !strings.ContainsAny(s, " \t\n'\"$\\") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func isClosedPipe(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrClosed) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "file already closed") ||
		strings.Contains(msg, "use of closed file")
}

type limitWriter struct {
	w io.StringWriter
	n int
}

func (l *limitWriter) Write(p []byte) (int, error) {
	orig := len(p)
	if l.n <= 0 {
		return orig, nil
	}
	if len(p) > l.n {
		p = p[:l.n]
	}
	n, err := l.w.WriteString(string(p))
	l.n -= n
	return orig, err
}
