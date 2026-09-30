package search

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"web-grep/internal/config"
	"web-grep/internal/rg"
)

// matchEngine emits a fixed list of matches, as rg would.
type matchEngine struct{ matches []rg.Match }

func (matchEngine) Kind() string { return "rg" }
func (e matchEngine) Search(_ context.Context, _ rg.Input, emit func(rg.Match) error, _ func(int)) error {
	for _, m := range e.matches {
		if err := emit(m); err != nil {
			return err
		}
	}
	return nil
}

// terminalStream also remembers the done payload.
type terminalStream struct {
	memStream
	done map[string]any
}

func (s *terminalStream) Event(name string, data any) error {
	if name == "done" {
		if m, ok := data.(map[string]any); ok {
			s.done = m
		}
	}
	return s.memStream.Event(name, data)
}

func TestRunDropsHitsThatResolveOutsideRoot(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "root", "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(filepath.Join(base, "root"))
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{
		filepath.Join(root, "src", "a.txt"): "hello\n",
		filepath.Join(outside, "leak.txt"):  "hello\n",
	} {
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(outside, filepath.Join(root, "link-out")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(root, "src"), filepath.Join(root, "link-in")); err != nil {
		t.Fatal(err)
	}

	mk := func(path string) rg.Match { return rg.Match{Path: path, Line: 1, Text: "hello\n"} }
	eng := matchEngine{matches: []rg.Match{
		mk("src/a.txt"),
		mk("link-out/leak.txt"), // reaches outside the root: must be dropped
		mk("link-in/a.txt"),     // stays inside the root: kept
	}}
	cfg := config.Config{
		RootReal:       root,
		RootLabel:      "root",
		MaxResults:     100,
		MaxConcurrent:  2,
		FollowSymlinks: true,
	}
	svc := New(cfg, eng, "rg", nil)
	pre := svc.Preflight(Request{Query: "hello", Hidden: true})
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	stream := &terminalStream{}
	svc.Run(context.Background(), pre, stream)

	if got, want := stream.hits(), []string{"src/a.txt", "link-in/a.txt"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("hits = %v, want %v", got, want)
	}
	// A dropped hit must not count toward the totals or the result cap.
	if stream.done["matchCount"] != 2 || stream.done["fileCount"] != 2 {
		t.Fatalf("done = %v, want matchCount=2 fileCount=2", stream.done)
	}
}
