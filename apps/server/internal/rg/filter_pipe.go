package rg

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"web-grep/internal/logx"
)

// Batch flush knobs. rg 15 keeps match lines in its stdout buffer until the
// filter sees EOF, even with --line-buffered, so a long-lived filter pipe
// deadlocks against it. Judging a closed batch does not depend on when rg
// decides to write. Tune these together: a larger batch spends less time in
// process startup, a smaller one returns the first interactive hits sooner.
const (
	// maxBatchHits flushes once this many surviving matches are queued.
	maxBatchHits = 4096

	// maxBatchBytes flushes once queued raw line bytes (each line already
	// ends with one '\n') reach this size. A single line at least this
	// long is its own batch, so one huge line is not stuck waiting for
	// more input that may never come.
	maxBatchBytes = 2 << 20

	// idleFlush flushes a non-empty batch after the head has produced no
	// further match for this long. That is the interactive first-hit path.
	idleFlush = 20 * time.Millisecond

	// maxBatchAge flushes once the oldest queued match has waited this
	// long, even if matches are still arriving slowly.
	maxBatchAge = 150 * time.Millisecond

	// headQueue is the bound on matches sitting between the head reader
	// and the batcher. The head keeps scanning while a batch is judged,
	// and a full queue is what applies backpressure.
	headQueue = maxBatchHits
)

// filterLineArgv is BuildFilterArgv plus the flags that make each stdin
// line produce exactly one stdout line: "N:text" on a match and "N-text"
// otherwise. Flags sit before "--".
//
// --line-buffered is intentionally absent. rg 15.0.0 does not stream with
// it; the batch is closed (stdin EOF) before its stdout is read, so the
// filter's own buffering does not matter.
//
// --encoding none matches the raw bytes of each line. The text written here
// is the line already taken from the head rg's JSON, so this rg must not
// sniff a BOM on stdin and transcode it. A line that itself starts with a
// BOM is judged as those bytes, with no transcoding. That disagrees with
// default `printf line | rg` for a BOM-leading line, because rg sniffs a BOM
// only at the start of that stdin; every other line (including non-ASCII,
// quotes, and CRLF) agrees. Sniffing once per process would also make one
// line's verdict depend on the lines before it.
func filterLineArgv(base []string) []string {
	extra := []string{"--passthru", "--line-number", "--no-filename", "-a", "--encoding", "none"}
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

type queuedMatch struct {
	m       Match
	payload []byte
}

type headEvent struct {
	begin bool
	match queuedMatch
	err   error
}

// liveProcs is the set of rg processes this search has started and not yet
// waited. Cancel terminates the current set; finished commands are removed
// so a later cancel does not signal a reused pid.
type liveProcs struct {
	mu   sync.Mutex
	cmds []*exec.Cmd
}

func (p *liveProcs) add(cmd *exec.Cmd) {
	p.mu.Lock()
	p.cmds = append(p.cmds, cmd)
	p.mu.Unlock()
}

func (p *liveProcs) remove(cmd *exec.Cmd) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, c := range p.cmds {
		if c != cmd {
			continue
		}
		last := len(p.cmds) - 1
		p.cmds[i] = p.cmds[last]
		p.cmds[last] = nil
		p.cmds = p.cmds[:last]
		return
	}
}

func (p *liveProcs) terminate() {
	p.mu.Lock()
	cmds := append([]*exec.Cmd(nil), p.cmds...)
	p.mu.Unlock()
	terminateAll(cmds)
}

func (e Engine) runFiltered(ctx context.Context, dir string, argv []string, filters [][]string, emit func(Match) error, progress func(files int), filesAlready int) (int, error) {
	// parent is the caller's context. The child is canceled when this
	// function decides to stop the pipeline; that must not be reported as
	// the caller's cancel, or a filter failure looks like a clean abort.
	parent := ctx
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	procs := &liveProcs{}
	head := exec.CommandContext(ctx, e.Bin, argv...)
	head.Dir = dir
	head.Env = Env()
	head.Cancel = terminateCmd(head)
	setProcAttr(head)
	headOut, err := head.StdoutPipe()
	if err != nil {
		return filesAlready, err
	}
	var headStderr strings.Builder
	head.Stderr = &limitWriter{w: &headStderr, n: stderrLimit}

	if logx.DebugEnabled() {
		logged := formatCmd(e.Bin, argv)
		for _, fargv := range filters {
			logged += " | " + formatCmd(e.Bin, filterLineArgv(fargv))
		}
		logx.Debug("rg", map[string]any{"cwd": dir, "cmd": logged})
	}

	if err := head.Start(); err != nil {
		_ = headOut.Close()
		return filesAlready, err
	}
	procs.add(head)

	// The watch is a second path next to CommandContext's Cancel: both end
	// the process group. Closing stopWatch makes the goroutine exit without
	// signaling, so a late wake cannot kill a pid that Wait already reaped.
	// Search waits for that goroutine before returning.
	stopWatch := make(chan struct{})
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		select {
		case <-ctx.Done():
			procs.terminate()
		case <-stopWatch:
		}
	}()
	defer func() {
		close(stopWatch)
		<-watchDone
	}()

	events := make(chan headEvent, headQueue)
	var readerWG sync.WaitGroup
	readerWG.Add(1)
	go func() {
		defer readerWG.Done()
		defer close(events)
		readHead(ctx, headOut, events)
	}()

	// Empty-stdin preflight runs beside the head. An illegal filter
	// pattern exits 2 before any match exists, including when the head
	// has nothing to judge. It must not be on the path of the first hit.
	preflightCh := make(chan error, 1)
	var preflightWG sync.WaitGroup
	preflightWG.Add(1)
	go func() {
		defer preflightWG.Done()
		err := e.preflightFilters(ctx, dir, filters, procs)
		select {
		case preflightCh <- err:
		case <-ctx.Done():
		}
	}()

	files, emitErr, runErr := e.consume(ctx, dir, filters, events, preflightCh, emit, progress, filesAlready, procs)

	if emitErr != nil || runErr != nil || parent.Err() != nil {
		cancel()
		procs.terminate()
	}
	readerWG.Wait()
	// Drop the head from the live set before Wait so the watch's snapshot
	// cannot include it once the pid is eligible for reuse.
	procs.remove(head)
	headErr := head.Wait()
	preflightWG.Wait()

	if emitErr != nil {
		return files, emitErr
	}
	if err := parent.Err(); err != nil {
		return files, err
	}
	if runErr != nil && !errors.Is(runErr, context.Canceled) && !errors.Is(runErr, context.DeadlineExceeded) {
		return files, runErr
	}
	msg := strings.TrimSpace(headStderr.String())
	if headErr != nil && !benignRgExit(headErr) {
		if partialRgExit(headErr, msg) && runErr == nil {
			logx.Warn("rg skipped unreadable paths", map[string]any{"stages": 1})
		} else if msg != "" {
			return files, rgStderrError(dir, msg)
		} else if runErr == nil {
			return files, headErr
		}
	}
	if runErr != nil {
		return files, runErr
	}
	return files, nil
}

func terminateCmd(cmd *exec.Cmd) func() error {
	return func() error {
		terminate(cmd)
		return nil
	}
}

func rgStderrError(dir, msg string) error {
	msg = strings.TrimSpace(msg)
	head, n := logx.ClipForLog(msg, dir, filepath.Base(dir))
	logx.Warn("rg stderr", map[string]any{"stderr": head, "lines": n})
	logx.Debug("rg stderr", map[string]any{"stderr": msg})
	return fmt.Errorf("%s", msg)
}

func readHead(ctx context.Context, r io.Reader, out chan<- headEvent) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	send := func(ev headEvent) bool {
		select {
		case out <- ev:
			return true
		case <-ctx.Done():
			return false
		}
	}
	for sc.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := sc.Bytes()
		if IsBeginLine(line) {
			if !send(headEvent{begin: true}) {
				return
			}
			continue
		}
		m, payload, ok := parseMatchRecord(line)
		if !ok {
			continue
		}
		if payload == nil {
			send(headEvent{err: errors.New("rg match line has undecodable bytes")})
			return
		}
		if !send(headEvent{match: queuedMatch{m: m, payload: payload}}) {
			return
		}
	}
	if err := sc.Err(); err != nil && ctx.Err() == nil && !isClosedPipe(err) {
		send(headEvent{err: err})
	}
}

func (e Engine) preflightFilters(ctx context.Context, dir string, filters [][]string, procs *liveProcs) error {
	errc := make(chan error, len(filters))
	var wg sync.WaitGroup
	for i, fargv := range filters {
		wg.Add(1)
		go func(i int, fargv []string) {
			defer wg.Done()
			if _, err := e.runOneFilter(ctx, dir, fargv, nil, 0, i, procs); err != nil {
				errc <- err
			}
		}(i, fargv)
	}
	wg.Wait()
	close(errc)
	for err := range errc {
		if err != nil {
			return err
		}
	}
	return nil
}

func (e Engine) consume(ctx context.Context, dir string, filters [][]string, events <-chan headEvent, preflightCh chan error, emit func(Match) error, progress func(int), filesAlready int, procs *liveProcs) (files int, emitErr, runErr error) {
	files = filesAlready
	var (
		batch      []queuedMatch
		batchBytes int
		batchFirst time.Time
		batchLast  time.Time
		timer      *time.Timer
		wakeC      <-chan time.Time
	)
	stopWake := func() {
		if timer == nil {
			wakeC = nil
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		wakeC = nil
	}
	armWake := func() {
		stopWake()
		if len(batch) == 0 {
			return
		}
		d := batchWakeDelay(batchFirst, batchLast)
		if timer == nil {
			timer = time.NewTimer(d)
		} else {
			timer.Reset(d)
		}
		wakeC = timer.C
	}
	defer stopWake()

	flush := func() (error, error) {
		if len(batch) == 0 {
			stopWake()
			return nil, nil
		}
		hits := batch
		batch = nil
		batchBytes = 0
		batchFirst = time.Time{}
		batchLast = time.Time{}
		stopWake()
		return e.judgeBatch(ctx, dir, filters, hits, emit, procs)
	}

	for {
		if preflightCh != nil {
			select {
			case err := <-preflightCh:
				preflightCh = nil
				if err != nil {
					return files, nil, err
				}
			default:
			}
		}
		select {
		case <-ctx.Done():
			return files, nil, ctx.Err()
		case err := <-preflightCh:
			preflightCh = nil
			if err != nil {
				return files, nil, err
			}
		case <-wakeC:
			if eErr, rErr := flush(); eErr != nil || rErr != nil {
				return files, eErr, rErr
			}
		case ev, ok := <-events:
			if !ok {
				if err := ctx.Err(); err != nil {
					return files, nil, err
				}
				if eErr, rErr := flush(); eErr != nil || rErr != nil {
					return files, eErr, rErr
				}
				if preflightCh != nil {
					select {
					case err := <-preflightCh:
						if err != nil {
							return files, nil, err
						}
					case <-ctx.Done():
						return files, nil, ctx.Err()
					}
				}
				return files, nil, nil
			}
			if ev.err != nil {
				return files, nil, ev.err
			}
			if ev.begin {
				files++
				if progress != nil {
					progress(files)
				}
				continue
			}
			if eErr, rErr := enqueueMatch(&batch, &batchBytes, &batchFirst, &batchLast, ev.match, flush, armWake); eErr != nil || rErr != nil {
				return files, eErr, rErr
			}
		}
	}
}

// enqueueMatch appends one match and flushes when the batch is full.
// A line of maxBatchBytes or more is flushed as a batch by itself.
func enqueueMatch(batch *[]queuedMatch, batchBytes *int, first, last *time.Time, m queuedMatch, flush func() (error, error), armWake func()) (error, error) {
	if len(m.payload) >= maxBatchBytes {
		if eErr, rErr := flush(); eErr != nil || rErr != nil {
			return eErr, rErr
		}
		*batch = append(*batch, m)
		*batchBytes = len(m.payload)
		now := time.Now()
		*first = now
		*last = now
		return flush()
	}
	if len(*batch) > 0 && *batchBytes+len(m.payload) > maxBatchBytes {
		if eErr, rErr := flush(); eErr != nil || rErr != nil {
			return eErr, rErr
		}
	}
	now := time.Now()
	if len(*batch) == 0 {
		*first = now
	}
	*batch = append(*batch, m)
	*batchBytes += len(m.payload)
	*last = now
	if len(*batch) >= maxBatchHits || *batchBytes >= maxBatchBytes {
		return flush()
	}
	armWake()
	return nil, nil
}

func batchWakeDelay(first, last time.Time) time.Duration {
	now := time.Now()
	deadline := last.Add(idleFlush)
	if age := first.Add(maxBatchAge); age.Before(deadline) {
		deadline = age
	}
	d := deadline.Sub(now)
	if d < 0 {
		return 0
	}
	return d
}

// judgeBatch runs each filter over the lines the previous filter kept.
// Passing hits are emitted in the head's order.
func (e Engine) judgeBatch(ctx context.Context, dir string, filters [][]string, hits []queuedMatch, emit func(Match) error, procs *liveProcs) (emitErr, runErr error) {
	idx := make([]int, len(hits))
	for i := range hits {
		idx[i] = i
	}
	for fi, fargv := range filters {
		if len(idx) == 0 {
			break
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var buf bytes.Buffer
		for _, i := range idx {
			buf.Write(hits[i].payload)
		}
		pass, err := e.runOneFilter(ctx, dir, fargv, buf.Bytes(), len(idx), fi, procs)
		if err != nil {
			return nil, err
		}
		if len(pass) != len(idx) {
			return nil, fmt.Errorf("rg filter ended before judging every match: filter %d judged %d, fed %d", fi+1, len(pass), len(idx))
		}
		next := make([]int, 0, len(idx))
		for j, i := range idx {
			if pass[j] {
				next = append(next, i)
			}
		}
		idx = next
	}
	for _, i := range idx {
		if err := emit(hits[i].m); err != nil {
			return err, nil
		}
	}
	return nil, nil
}

// runOneFilter runs one filter rg over stdin and returns one bool per fed
// line. fed == 0 (empty preflight) still runs rg so a bad pattern fails
// before the head has any match. Exit 0 and 1 are success; any other exit
// is returned with stderr. partialRgExit stays a non-error. The number of
// parsed stdout lines must equal fed.
func (e Engine) runOneFilter(ctx context.Context, dir string, base []string, stdin []byte, fed, index int, procs *liveProcs) ([]bool, error) {
	cmd := exec.CommandContext(ctx, e.Bin, filterLineArgv(base)...)
	cmd.Dir = dir
	cmd.Env = Env()
	cmd.Cancel = terminateCmd(cmd)
	setProcAttr(cmd)
	if stdin == nil {
		stdin = []byte{}
	}
	cmd.Stdin = bytes.NewReader(stdin)
	var stderr strings.Builder
	cmd.Stderr = &limitWriter{w: &stderr, n: stderrLimit}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdout.Close()
		return nil, err
	}
	procs.add(cmd)
	defer procs.remove(cmd)

	out, readErr := io.ReadAll(stdout)
	waitErr := cmd.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if readErr != nil && !isClosedPipe(readErr) {
		return nil, readErr
	}
	if err := filterExitError(dir, waitErr, stderr.String()); err != nil {
		return nil, err
	}
	return parsePassthruOutput(out, fed, index)
}

func filterExitError(dir string, err error, stderr string) error {
	if err == nil || benignFilterExit(err) {
		return nil
	}
	if partialRgExit(err, stderr) {
		logx.Warn("rg skipped unreadable paths", map[string]any{"stages": 1})
		return nil
	}
	if msg := strings.TrimSpace(stderr); msg != "" {
		return rgStderrError(dir, msg)
	}
	return err
}

func benignFilterExit(err error) bool {
	var ee *exec.ExitError
	if !errors.As(err, &ee) {
		return false
	}
	switch ee.ExitCode() {
	case 0, 1:
		return true
	default:
		return false
	}
}

func parsePassthruOutput(out []byte, fed, index int) ([]bool, error) {
	pass := make([]bool, 0, fed)
	if len(out) == 0 {
		if fed == 0 {
			return nil, nil
		}
		return nil, fmt.Errorf("rg filter ended before judging every match: filter %d judged %d, fed %d", index+1, 0, fed)
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024+4096)
	for sc.Scan() {
		n, okPass, ok := parsePassthruPrefix(sc.Bytes())
		if !ok {
			return nil, fmt.Errorf("rg filter %d: unexpected output %q", index+1, clipLine(sc.Bytes()))
		}
		want := len(pass) + 1
		if n != want {
			return nil, fmt.Errorf("rg filter %d result %d out of order, want %d", index+1, n, want)
		}
		pass = append(pass, okPass)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(pass) != fed {
		return nil, fmt.Errorf("rg filter ended before judging every match: filter %d judged %d, fed %d", index+1, len(pass), fed)
	}
	return pass, nil
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
