package search

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/rg"
)

type memStream struct {
	mu     sync.Mutex
	events []string
	paths  []string
}

func (m *memStream) Event(name string, data any) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, name)
	if name == "hit" {
		if hit, ok := data.(rg.Hit); ok {
			m.paths = append(m.paths, hit.Path)
		}
	}
	return nil
}
func (m *memStream) Ping()         {}
func (m *memStream) Flush() error  { return nil }
func (m *memStream) Aborted() bool { return false }
func (m *memStream) names() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.events))
	copy(out, m.events)
	return out
}
func (m *memStream) hits() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.paths))
	copy(out, m.paths)
	return out
}

type captureEngine struct {
	mu sync.Mutex
	in rg.Input
}

func (c *captureEngine) Kind() string { return "rg" }
func (c *captureEngine) Search(_ context.Context, in rg.Input, _ func(rg.Match) error, _ func(int)) error {
	c.mu.Lock()
	c.in = in
	c.mu.Unlock()
	return nil
}

type blockingEngine struct {
	started chan struct{}
	release chan struct{}
}

func (b blockingEngine) Kind() string { return "rg" }
func (b blockingEngine) Search(ctx context.Context, _ rg.Input, _ func(rg.Match) error, _ func(int)) error {
	select {
	case b.started <- struct{}{}:
	default:
	}
	select {
	case <-b.release:
	case <-ctx.Done():
		return ctx.Err()
	}
	return nil
}

type errEngine struct{ err error }

func (e errEngine) Kind() string { return "rg" }
func (e errEngine) Search(context.Context, rg.Input, func(rg.Match) error, func(int)) error {
	return e.err
}

func testService(t *testing.T, eng Engine, maxC, timeoutMs int) *Service {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		RootReal:      root,
		RootLabel:     filepath.Base(root),
		MaxResults:    100,
		MaxConcurrent: maxC,
		TimeoutMs:     timeoutMs,
	}
	return New(cfg, eng, "rg", nil)
}

func TestNeedsMtimeFileList(t *testing.T) {
	if NeedsMtimeFileList(time.Time{}) {
		t.Fatal("zero mtime must skip walk")
	}
	if !NeedsMtimeFileList(time.Now().Add(-time.Hour)) {
		t.Fatal("set mtime must walk")
	}
}

func TestNeedGlobAndPostFilter(t *testing.T) {
	if NeedGlobAndPostFilter(nil, []string{"*.ts"}) {
		t.Fatal("and-only is pushed to rg --glob")
	}
	if NeedGlobAndPostFilter([]string{"src/**"}, nil) {
		t.Fatal("include-only is pushed to rg --glob")
	}
	if !NeedGlobAndPostFilter([]string{"src/**"}, []string{"*.ts"}) {
		t.Fatal("include∩and cannot be expressed as rg --glob")
	}
}

func TestRunSkipsWalkWithoutMtime(t *testing.T) {
	walked := false
	orig := listNewerFiles
	listNewerFiles = func(ctx context.Context, rootReal, rel string, after time.Time, hidden, follow, allowSecrets bool, exclude []string) ([]string, error) {
		walked = true
		return orig(ctx, rootReal, rel, after, hidden, follow, allowSecrets, exclude)
	}
	t.Cleanup(func() { listNewerFiles = orig })

	eng := &captureEngine{}
	svc := testService(t, eng, 2, 0)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	svc.Run(context.Background(), pre, &memStream{})
	if walked {
		t.Fatal("WalkDir ran without mtimeAfter")
	}
	if eng.in.LimitToList {
		t.Fatal("expected rg to search the root, not a pre-listed file set")
	}
	if svc.Inflight() != 0 {
		t.Fatalf("slot leak: %d", svc.Inflight())
	}
}

func TestRunPushesGlobsToRgWithoutMtime(t *testing.T) {
	walked := false
	orig := listNewerFiles
	listNewerFiles = func(ctx context.Context, rootReal, rel string, after time.Time, hidden, follow, allowSecrets bool, exclude []string) ([]string, error) {
		walked = true
		return orig(ctx, rootReal, rel, after, hidden, follow, allowSecrets, exclude)
	}
	t.Cleanup(func() { listNewerFiles = orig })

	eng := &captureEngine{}
	svc := testService(t, eng, 2, 0)
	pre := svc.Preflight(Request{
		Query:       "hello",
		Hidden:      true,
		GlobInclude: []string{"src/**"},
		GlobAnd:     []string{"*.ts"},
		GlobExclude: []string{"*.test.ts"},
	})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	svc.Run(context.Background(), pre, &memStream{})
	if walked {
		t.Fatal("globs must not force WalkDir")
	}
	if eng.in.LimitToList {
		t.Fatal("expected rg to search the root with globs")
	}
	if len(eng.in.GlobInclude) != 1 || eng.in.GlobInclude[0] != "src/**" {
		t.Fatalf("include: %v", eng.in.GlobInclude)
	}
	if len(eng.in.GlobAnd) != 1 || eng.in.GlobAnd[0] != "*.ts" {
		t.Fatalf("and: %v", eng.in.GlobAnd)
	}
	if len(eng.in.GlobExclude) != 1 || eng.in.GlobExclude[0] != "*.test.ts" {
		t.Fatalf("exclude: %v", eng.in.GlobExclude)
	}
}

func TestRunPostFiltersGlobAndIntersection(t *testing.T) {
	root := ""
	eng := emitEngine{matches: []rg.Match{
		{Path: "src/a.ts", Line: 1, Text: "hello\n"},
		{Path: "src/b.js", Line: 1, Text: "hello\n"},
		{Path: "other.ts", Line: 1, Text: "hello\n"},
	}}
	svc := testService(t, &eng, 2, 0)
	root = svc.Snapshot().RootReal
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"src/a.ts", "src/b.js", "other.ts"} {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(name)), []byte("hello\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pre := svc.Preflight(Request{
		Query:       "hello",
		Hidden:      true,
		GlobInclude: []string{"src/**"},
		GlobAnd:     []string{"*.ts"},
	})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	stream := &memStream{}
	svc.Run(context.Background(), pre, stream)
	hits := stream.hits()
	if len(hits) != 1 || hits[0] != "src/a.ts" {
		t.Fatalf("include∩and should keep only src/a.ts, got %v events=%v", hits, stream.names())
	}
}

func TestSetCfgSwapIsAtomic(t *testing.T) {
	svc := testService(t, &captureEngine{}, 2, 0)
	a := svc.Snapshot()
	a.RootLabel = "a"
	a.RootReal = "/a"
	a.MaxResults = 1
	b := a
	b.RootLabel = "b"
	b.RootReal = "/b"
	b.MaxResults = 2
	svc.SetCfg(a)

	var writers sync.WaitGroup
	writers.Add(2)
	done := make(chan struct{})
	errCh := make(chan config.Config, 1)
	for i := 0; i < 2; i++ {
		go func() {
			defer writers.Done()
			for n := 0; n < 1000; n++ {
				if n%2 == 0 {
					svc.SetCfg(a)
				} else {
					svc.SetCfg(b)
				}
			}
		}()
	}
	var readers sync.WaitGroup
	readers.Add(4)
	for i := 0; i < 4; i++ {
		go func() {
			defer readers.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				got := svc.Snapshot()
				okA := got.RootLabel == "a" && got.RootReal == "/a" && got.MaxResults == 1
				okB := got.RootLabel == "b" && got.RootReal == "/b" && got.MaxResults == 2
				if !okA && !okB {
					select {
					case errCh <- got:
					default:
					}
					return
				}
			}
		}()
	}
	writers.Wait()
	close(done)
	readers.Wait()
	select {
	case got := <-errCh:
		t.Fatalf("torn config: %+v", got)
	default:
	}
}

type emitEngine struct {
	matches []rg.Match
}

func (e *emitEngine) Kind() string { return "rg" }
func (e *emitEngine) Search(_ context.Context, _ rg.Input, emit func(rg.Match) error, _ func(int)) error {
	for _, m := range e.matches {
		if err := emit(m); err != nil {
			return err
		}
	}
	return nil
}

func TestRunWalksWhenMtimeAfterSet(t *testing.T) {
	walked := false
	orig := listNewerFiles
	listNewerFiles = func(ctx context.Context, rootReal, rel string, after time.Time, hidden, follow, allowSecrets bool, exclude []string) ([]string, error) {
		walked = true
		return orig(ctx, rootReal, rel, after, hidden, follow, allowSecrets, exclude)
	}
	t.Cleanup(func() { listNewerFiles = orig })

	eng := &captureEngine{}
	svc := testService(t, eng, 2, 0)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true, MtimeAfter: time.Now().Add(-time.Hour)})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	svc.Run(context.Background(), pre, &memStream{})
	if !walked {
		t.Fatal("mtimeAfter must still WalkDir and list files")
	}
	if !eng.in.LimitToList {
		t.Fatal("mtimeAfter must pass a pre-filtered file list to rg")
	}
	if svc.Inflight() != 0 {
		t.Fatalf("slot leak: %d", svc.Inflight())
	}
}

func TestSlotReleasedOnCancel(t *testing.T) {
	started := make(chan struct{}, 1)
	svc := testService(t, blockingEngine{started: started, release: make(chan struct{})}, 2, 0)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		svc.Run(ctx, pre, &memStream{})
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("search did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
	if svc.Inflight() != 0 {
		t.Fatalf("slot leaked after cancel: %d", svc.Inflight())
	}
	next := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !next.OK {
		t.Fatalf("expected free slot after cancel, got %+v", next)
	}
	svc.Release(next.SearchID)
}

func TestSlotReleasedOnError(t *testing.T) {
	svc := testService(t, errEngine{err: errors.New("boom")}, 2, 0)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	stream := &memStream{}
	svc.Run(context.Background(), pre, stream)
	if svc.Inflight() != 0 {
		t.Fatalf("slot leaked after error: %d", svc.Inflight())
	}
	names := stream.names()
	if len(names) < 2 || names[0] != "meta" || names[len(names)-1] != "error" {
		t.Fatalf("sse order: %v", names)
	}
	next := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !next.OK {
		t.Fatalf("expected free slot after error, got %+v", next)
	}
	svc.Release(next.SearchID)
}

func TestSlotReleasedOnTimeout(t *testing.T) {
	started := make(chan struct{}, 1)
	svc := testService(t, blockingEngine{started: started, release: make(chan struct{})}, 2, 40)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	stream := &memStream{}
	svc.Run(context.Background(), pre, stream)
	if svc.Inflight() != 0 {
		t.Fatalf("slot leaked after timeout: %d", svc.Inflight())
	}
	names := stream.names()
	if names[len(names)-1] != "done" {
		t.Fatalf("timeout should emit done, got %v", names)
	}
}

func TestSlotReleasedOnEarlyReturn(t *testing.T) {
	svc := testService(t, &captureEngine{}, 2, 0)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true, GlobInclude: []string{".env"}})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	if len(pre.GlobInclude) != 0 {
		t.Fatalf("denied include should be dropped: %v", pre.GlobInclude)
	}
	svc.Run(context.Background(), pre, &memStream{})
	if svc.Inflight() != 0 {
		t.Fatalf("slot leaked after early done: %d", svc.Inflight())
	}
}

func TestBusyAtMaxConcurrentThenRecovers(t *testing.T) {
	const n = 2
	started := make(chan struct{}, n)
	release := make(chan struct{})
	svc := testService(t, blockingEngine{started: started, release: release}, n, 0)

	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		pre := svc.Preflight(Request{Query: "hello", Hidden: true})
		if !pre.OK {
			t.Fatalf("preflight %d: %+v", i, pre)
		}
		go func(p Preflight) {
			defer wg.Done()
			svc.Run(context.Background(), p, &memStream{})
		}(pre)
	}
	deadline := time.After(2 * time.Second)
	for i := 0; i < n; i++ {
		select {
		case <-started:
		case <-deadline:
			t.Fatal("searches did not start")
		}
	}
	busy := svc.Preflight(Request{Query: "hello", Hidden: true})
	if busy.OK || busy.Code != "BUSY" || busy.Status != 429 {
		t.Fatalf("expected BUSY, got %+v", busy)
	}
	if svc.Inflight() != n {
		t.Fatalf("BUSY must not take a slot: inflight=%d", svc.Inflight())
	}
	close(release)
	wg.Wait()
	if svc.Inflight() != 0 {
		t.Fatalf("slots leaked: %d", svc.Inflight())
	}
	next := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !next.OK {
		t.Fatalf("expected free slot after release, got %+v", next)
	}
	svc.Release(next.SearchID)
}

func TestCancelOneOfMaxConcurrentFreesExactlyOneSlot(t *testing.T) {
	const n = 2
	started := make(chan struct{}, n)
	release := make(chan struct{})
	svc := testService(t, blockingEngine{started: started, release: release}, n, 0)

	pre1 := svc.Preflight(Request{Query: "hello", Hidden: true})
	pre2 := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !pre1.OK || !pre2.OK {
		t.Fatalf("preflight: %+v %+v", pre1, pre2)
	}

	ctx1, cancel1 := context.WithCancel(context.Background())
	done1 := make(chan struct{})
	done2 := make(chan struct{})
	go func() {
		defer close(done1)
		svc.Run(ctx1, pre1, &memStream{})
	}()
	go func() {
		defer close(done2)
		svc.Run(context.Background(), pre2, &memStream{})
	}()
	deadline := time.After(2 * time.Second)
	for i := 0; i < n; i++ {
		select {
		case <-started:
		case <-deadline:
			t.Fatal("searches did not start")
		}
	}

	busy := svc.Preflight(Request{Query: "hello", Hidden: true})
	if busy.OK || busy.Code != "BUSY" {
		t.Fatalf("expected BUSY at cap, got %+v", busy)
	}

	cancel1()
	select {
	case <-done1:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
	if svc.Inflight() != n-1 {
		t.Fatalf("cancel should free one slot, inflight=%d", svc.Inflight())
	}

	next := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !next.OK {
		t.Fatalf("expected free slot after cancel, got %+v", next)
	}
	stillBusy := svc.Preflight(Request{Query: "hello", Hidden: true})
	if stillBusy.OK || stillBusy.Code != "BUSY" {
		t.Fatalf("cap should still hold after replacing the cancelled slot: %+v", stillBusy)
	}
	svc.Release(next.SearchID)

	close(release)
	select {
	case <-done2:
	case <-time.After(2 * time.Second):
		t.Fatal("held Run did not return")
	}
	if svc.Inflight() != 0 {
		t.Fatalf("slots leaked: %d", svc.Inflight())
	}
}

func TestPreflightDefaultMaxConcurrentIsEight(t *testing.T) {
	svc := testService(t, &captureEngine{}, 0, 0)
	held := make([]string, 0, config.MaxConcurrentDefault)
	for i := 0; i < config.MaxConcurrentDefault; i++ {
		pre := svc.Preflight(Request{Query: "hello", Hidden: true})
		if !pre.OK {
			t.Fatalf("slot %d: %+v", i, pre)
		}
		held = append(held, pre.SearchID)
	}
	busy := svc.Preflight(Request{Query: "hello", Hidden: true})
	if busy.Code != "BUSY" {
		t.Fatalf("9th search should be BUSY with default 8, got %+v", busy)
	}
	if svc.Inflight() != config.MaxConcurrentDefault {
		t.Fatalf("BUSY acquired a slot: %d", svc.Inflight())
	}
	svc.Release(held[0])
	next := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !next.OK {
		t.Fatalf("release should free a default slot: %+v", next)
	}
	held[0] = next.SearchID
	for _, id := range held {
		svc.Release(id)
	}
	if svc.Inflight() != 0 {
		t.Fatalf("slots leaked: %d", svc.Inflight())
	}
}
