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

func (e Engine) Search(ctx context.Context, in Input, emit func(Match) error, progress func(files int)) error {
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
			n, err := e.run(ctx, in.RootReal, argv, emit, progress, seen)
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
	_, err = e.run(ctx, in.RootReal, argv, emit, progress, 0)
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

func (e Engine) run(ctx context.Context, dir string, argv []string, emit func(Match) error, progress func(files int), filesAlready int) (int, error) {
	// CommandContext + StdoutPipe races: Wait/cancel close the pipe while Scan
	// still reads, which surfaces as "read |0: file already closed".
	cmd := exec.Command(e.Bin, argv...)
	cmd.Dir = dir
	cmd.Env = Env()
	setProcAttr(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return filesAlready, err
	}
	var stderr strings.Builder
	cmd.Stderr = &limitWriter{w: &stderr, n: 8192}
	if logCmd() {
		logx.Info("rg", map[string]any{
			"cwd": dir,
			"cmd": formatCmd(e.Bin, argv),
		})
	}
	if err := cmd.Start(); err != nil {
		return filesAlready, err
	}

	stopWatch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			terminate(cmd)
		case <-stopWatch:
		}
	}()

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
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
			terminate(cmd)
			break
		}
	}
	scanErr := sc.Err()
	waitErr := cmd.Wait()
	close(stopWatch)

	if emitErr != nil {
		return files, emitErr
	}
	if ctx.Err() != nil {
		return files, ctx.Err()
	}
	if waitErr != nil {
		if ee, ok := waitErr.(*exec.ExitError); ok && ee.ExitCode() == 1 {
			return files, nil
		}
		msg := strings.TrimSpace(stderr.String())
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
