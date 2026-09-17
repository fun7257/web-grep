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
}

func (m *memStream) Event(name string, _ any) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, name)
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
