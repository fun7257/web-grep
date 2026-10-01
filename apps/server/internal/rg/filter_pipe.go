package rg

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"web-grep/internal/logx"
)

// filterInflight bounds matches that have been handed to the filter
// processes but not yet judged, and the per-filter result channels.
const filterInflight = 32

// filterLineArgv is BuildFilterArgv plus the flags that make each stdin
// line produce exactly one stdout line: "N:text" when it matches and
// "N-text" when it does not. Flags sit before "--".
func filterLineArgv(base []string) []string {
	extra := []string{"--passthru", "--line-number", "--no-filename", "--line-buffered", "-a"}
	n := len(base)
	out := make([]string, 0, n+len(extra))
	if n >= 2 && base[n-2] == "--" {
		out = append(out, base[:n-2]...)
		out = append(out, extra...)
		out = append(out, base[n-2:]...)
		return out
	}
	out = append(out, extra...)
	out = append(out, base...)
	return out
}

type filterDecision struct {
	n    int
	pass bool
}

type filterStage struct {
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	bw        *bufio.Writer
	stdout    io.ReadCloser
	decisions chan filterDecision
	nextN     int
	readErr   error
}

func (e Engine) runFiltered(ctx context.Context, dir string, argv []string, filters [][]string, emit func(Match) error, progress func(files int), filesAlready int) (int, error) {
	// parent is the caller's context. The child is canceled when this
	// function decides to stop the pipeline; that must not be reported as
	// the caller's cancel, or a dead filter looks like a clean abort.
	parent := ctx
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	head := exec.Command(e.Bin, argv...)
	head.Dir = dir
	head.Env = Env()
	setProcAttr(head)
	headOut, err := head.StdoutPipe()
	if err != nil {
		return filesAlready, err
	}

	cmds := make([]*exec.Cmd, 0, 1+len(filters))
	cmds = append(cmds, head)
	stderrs := make([]strings.Builder, 1+len(filters))
	head.Stderr = &limitWriter{w: &stderrs[0], n: stderrLimit}

	stages := make([]*filterStage, len(filters))
	for i, fargv := range filters {
		cmd := exec.Command(e.Bin, filterLineArgv(fargv)...)
		cmd.Dir = dir
		cmd.Env = Env()
		setProcAttr(cmd)
		stdin, err := cmd.StdinPipe()
		if err != nil {
			_ = headOut.Close()
			closeFilterPipes(stages)
			return filesAlready, err
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			_ = stdin.Close()
			_ = headOut.Close()
			closeFilterPipes(stages)
			return filesAlready, err
		}
		cmd.Stderr = &limitWriter{w: &stderrs[i+1], n: stderrLimit}
		stages[i] = &filterStage{
			cmd:       cmd,
			stdin:     stdin,
			bw:        bufio.NewWriterSize(stdin, 32*1024),
			stdout:    stdout,
			decisions: make(chan filterDecision, filterInflight),
			nextN:     1,
		}
		cmds = append(cmds, cmd)
	}

	if logx.DebugEnabled() {
		logged := formatCmd(e.Bin, argv)
		for _, st := range stages {
			logged += " | " + formatCmd(st.cmd.Args[0], st.cmd.Args[1:])
		}
		logx.Debug("rg", map[string]any{"cwd": dir, "cmd": logged})
	}

	for i, cmd := range cmds {
		if err := cmd.Start(); err != nil {
			terminateAll(cmds[:i])
			_ = headOut.Close()
			closeFilterPipes(stages)
			for _, started := range cmds[:i] {
				_ = started.Wait()
			}
			return filesAlready, err
		}
	}

	var wg sync.WaitGroup
	for _, st := range stages {
		wg.Add(1)
		go func(st *filterStage) {
			defer wg.Done()
			defer close(st.decisions)
			st.readErr = readFilterDecisions(ctx, st.stdout, st.decisions)
		}(st)
	}

	stopWatch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			terminateAll(cmds)
		case <-stopWatch:
		}
	}()

	files, emitErr, runErr := judgeMatches(ctx, headOut, stages, emit, progress, filesAlready)

	if emitErr == nil && runErr == nil && parent.Err() == nil {
		for i, st := range stages {
			if ferr := st.bw.Flush(); ferr != nil && runErr == nil {
				runErr = filterWriteErr(i, ferr)
			}
		}
	}
	if emitErr != nil || runErr != nil || parent.Err() != nil {
		terminateAll(cmds)
		cancel()
	}
	for _, st := range stages {
		_ = st.stdin.Close()
	}
	wg.Wait()

	waitErr, partial := waitCmds(cmds, stderrs)
	close(stopWatch)
	if partial > 0 && waitErr == nil && emitErr == nil && runErr == nil && parent.Err() == nil {
		logx.Warn("rg skipped unreadable paths", map[string]any{"stages": partial})
	}

	if emitErr != nil {
		return files, emitErr
	}
	if err := parent.Err(); err != nil {
		return files, err
	}
	msg := joinedStderr(stderrs)
	if waitErr != nil && msg != "" {
		headMsg, n := logx.ClipForLog(msg, dir, filepath.Base(dir))
		logx.Warn("rg stderr", map[string]any{"stderr": headMsg, "lines": n})
		logx.Debug("rg stderr", map[string]any{"stderr": msg})
		return files, fmt.Errorf("%s", msg)
	}
	if runErr != nil && !isClosedPipe(runErr) {
		return files, runErr
	}
	if waitErr != nil {
		if msg != "" {
			headMsg, n := logx.ClipForLog(msg, dir, filepath.Base(dir))
			logx.Warn("rg stderr", map[string]any{"stderr": headMsg, "lines": n})
			logx.Debug("rg stderr", map[string]any{"stderr": msg})
			return files, fmt.Errorf("%s", msg)
		}
		return files, waitErr
	}
	return files, nil
}

func closeFilterPipes(stages []*filterStage) {
	for _, st := range stages {
		if st == nil {
			continue
		}
		if st.stdin != nil {
			_ = st.stdin.Close()
		}
		if st.stdout != nil {
			_ = st.stdout.Close()
		}
	}
}

func waitCmds(cmds []*exec.Cmd, stderrs []strings.Builder) (error, int) {
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
	return waitErr, partial
}

func joinedStderr(stderrs []strings.Builder) string {
	msg := ""
	for i := range stderrs {
		part := strings.TrimSpace(stderrs[i].String())
		if part == "" {
			continue
		}
		if msg != "" {
			msg += "; "
		}
		msg += part
	}
	return msg
}

func judgeMatches(ctx context.Context, head io.Reader, stages []*filterStage, emit func(Match) error, progress func(int), filesAlready int) (files int, emitErr, runErr error) {
	sc := bufio.NewScanner(head)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	files = filesAlready
	pending := make([]Match, 0, filterInflight)
	fed := 0

	flushOne := func() (error, error) {
		m := pending[0]
		copy(pending, pending[1:])
		pending[len(pending)-1] = Match{}
		pending = pending[:len(pending)-1]
		passAll := true
		for i, st := range stages {
			d, err := recvDecision(ctx, i, st)
			if err != nil {
				return nil, err
			}
			if d.n != st.nextN {
				return nil, fmt.Errorf("rg filter %d result %d out of order, want %d", i+1, d.n, st.nextN)
			}
			st.nextN++
			if !d.pass {
				passAll = false
			}
		}
		if !passAll {
			return nil, nil
		}
		if err := emit(m); err != nil {
			return err, nil
		}
		return nil, nil
	}

	for sc.Scan() {
		if err := ctx.Err(); err != nil {
			return files, nil, err
		}
		line := sc.Bytes()
		if IsBeginLine(line) {
			files++
			if progress != nil {
				progress(files)
			}
			continue
		}
		m, payload, ok := parseMatchRecord(line)
		if !ok {
			continue
		}
		if payload == nil {
			return files, nil, errors.New("rg match line has undecodable bytes")
		}
		if len(pending) == filterInflight {
			if eErr, rErr := flushOne(); eErr != nil || rErr != nil {
				return files, eErr, rErr
			}
		}
		if err := writeFilterLine(stages, payload); err != nil {
			return files, nil, err
		}
		pending = append(pending, m)
		fed++
	}
	if err := sc.Err(); err != nil && !isClosedPipe(err) {
		return files, nil, err
	}
	if err := ctx.Err(); err != nil {
		return files, nil, err
	}
	for len(pending) > 0 {
		if err := ctx.Err(); err != nil {
			return files, nil, err
		}
		if eErr, rErr := flushOne(); eErr != nil || rErr != nil {
			return files, eErr, rErr
		}
	}
	for i, st := range stages {
		if st.nextN != fed+1 {
			return files, nil, fmt.Errorf("rg filter %d judged %d matches, fed %d", i+1, st.nextN-1, fed)
		}
	}
	return files, nil, nil
}

func writeFilterLine(stages []*filterStage, payload []byte) error {
	for i, st := range stages {
		if _, err := st.bw.Write(payload); err != nil {
			return filterWriteErr(i, err)
		}
	}
	return nil
}

func filterWriteErr(i int, err error) error {
	if isBrokenPipe(err) {
		return fmt.Errorf("rg filter %d closed its pipe: %w", i+1, err)
	}
	return err
}

func recvDecision(ctx context.Context, i int, st *filterStage) (filterDecision, error) {
	select {
	case d, open := <-st.decisions:
		if !open {
			return filterDecision{}, filterClosedErr(st)
		}
		return d, nil
	case <-ctx.Done():
		return filterDecision{}, ctx.Err()
	default:
	}
	// Only this filter is waiting on input. Flushing the others can block
	// on a filter whose stdout reader is already parked on a full channel.
	if err := st.bw.Flush(); err != nil {
		return filterDecision{}, filterWriteErr(i, err)
	}
	select {
	case d, open := <-st.decisions:
		if !open {
			return filterDecision{}, filterClosedErr(st)
		}
		return d, nil
	case <-ctx.Done():
		return filterDecision{}, ctx.Err()
	}
}

func filterClosedErr(st *filterStage) error {
	if st.readErr != nil && !errors.Is(st.readErr, context.Canceled) && !isClosedPipe(st.readErr) {
		return st.readErr
	}
	return errors.New("rg filter ended before judging every match")
}

func readFilterDecisions(ctx context.Context, r io.ReadCloser, out chan<- filterDecision) error {
	defer r.Close()
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for sc.Scan() {
		n, pass, ok := parsePassthruPrefix(sc.Bytes())
		if !ok {
			return fmt.Errorf("rg filter: unexpected output %q", clipLine(sc.Bytes()))
		}
		select {
		case out <- filterDecision{n: n, pass: pass}:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := sc.Err(); err != nil && !isClosedPipe(err) {
		return err
	}
	return nil
}

func parsePassthruPrefix(line []byte) (n int, pass, ok bool) {
	if len(line) == 0 || line[0] < '0' || line[0] > '9' {
		return 0, false, false
	}
	i := 0
	for i < len(line) && line[i] >= '0' && line[i] <= '9' {
		n = n*10 + int(line[i]-'0')
		if n < 0 {
			return 0, false, false
		}
		i++
	}
	if i == 0 || i >= len(line) {
		return 0, false, false
	}
	switch line[i] {
	case ':':
		return n, true, true
	case '-':
		return n, false, true
	default:
		return 0, false, false
	}
}

func clipLine(b []byte) string {
	if len(b) > 80 {
		b = b[:80]
	}
	return string(b)
}

func isBrokenPipe(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, syscall.EPIPE) || errors.Is(err, io.ErrClosedPipe) || errors.Is(err, os.ErrClosed) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "broken pipe") || strings.Contains(msg, "closed pipe")
}
