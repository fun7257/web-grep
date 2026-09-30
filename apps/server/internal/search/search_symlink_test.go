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

	mk := func(path string, line int) rg.Match {
		return rg.Match{Path: path, Line: line, Text: "hello\n"}
	}
	eng := matchEngine{matches: []rg.Match{
		mk("src/a.txt", 1),
		mk("link-out/leak.txt", 1), // reaches outside the root: must be dropped
		mk("link-in/a.txt", 2),     // stays inside; a different line, so it is not a duplicate
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

func symlinkRoot(t *testing.T) string {
	t.Helper()
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
		filepath.Join(root, "src", "a.txt"): "alpha one\nalpha two\n",
		filepath.Join(root, "src", "b.txt"): "alpha b\n",
		filepath.Join(outside, "leak.txt"):  "alpha leak\n",
	} {
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	links := [][2]string{
		{outside, filepath.Join(root, "link-out")},
		{filepath.Join(root, "src", "a.txt"), filepath.Join(root, "link-file")},
		{filepath.Join(root, "src"), filepath.Join(root, "link-dir")},
	}
	for _, link := range links {
		if err := os.Symlink(link[0], link[1]); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
	}
	return root
}

func runSymlinkHits(t *testing.T, root string, matches []rg.Match, maxResults int) *terminalStream {
	t.Helper()
	cfg := config.Config{
		RootReal:       root,
		RootLabel:      "root",
		MaxResults:     100,
		MaxConcurrent:  2,
		FollowSymlinks: true,
	}
	svc := New(cfg, matchEngine{matches: matches}, "rg", nil)
	req := Request{Query: "alpha", Hidden: true}
	if maxResults > 0 {
		req.MaxResults = maxResults
	}
	pre := svc.Preflight(req)
	if !pre.OK {
		t.Fatalf("preflight: %+v", pre)
	}
	stream := &terminalStream{}
	svc.Run(context.Background(), pre, stream)
	if svc.Inflight() != 0 {
		t.Fatalf("slot leak: %d", svc.Inflight())
	}
	return stream
}

func assertEmitted(t *testing.T, stream *terminalStream, want []string) {
	t.Helper()
	got := stream.hits()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("hits = %v, want %v", got, want)
	}
	if stream.done["matchCount"] != len(want) {
		t.Fatalf("matchCount = %v, want %d", stream.done["matchCount"], len(want))
	}
	uniq := map[string]struct{}{}
	for _, p := range want {
		uniq[p] = struct{}{}
	}
	if stream.done["fileCount"] != len(uniq) {
		t.Fatalf("fileCount = %v, want %d", stream.done["fileCount"], len(uniq))
	}
	if stream.done["cancelled"] != false || stream.done["timedOut"] != false {
		t.Fatalf("done flags = %v", stream.done)
	}
}

func TestRunDedupesInRootSymlinks(t *testing.T) {
	root := symlinkRoot(t)
	mk := func(path string, line int) rg.Match {
		return rg.Match{Path: path, Line: line, Text: "alpha\n"}
	}

	t.Run("fileLinkOriginalFirst", func(t *testing.T) {
		s := runSymlinkHits(t, root, []rg.Match{mk("src/a.txt", 1), mk("link-file", 1)}, 0)
		assertEmitted(t, s, []string{"src/a.txt"})
		if s.done["truncated"] != false {
			t.Fatalf("truncated = %v", s.done["truncated"])
		}
	})
	t.Run("fileLinkLinkFirst", func(t *testing.T) {
		s := runSymlinkHits(t, root, []rg.Match{mk("link-file", 1), mk("src/a.txt", 1)}, 0)
		assertEmitted(t, s, []string{"link-file"})
	})
	t.Run("dirLinkOriginalFirst", func(t *testing.T) {
		s := runSymlinkHits(t, root, []rg.Match{mk("src/a.txt", 1), mk("link-dir/a.txt", 1)}, 0)
		assertEmitted(t, s, []string{"src/a.txt"})
	})
	t.Run("dirLinkLinkFirst", func(t *testing.T) {
		s := runSymlinkHits(t, root, []rg.Match{mk("link-dir/a.txt", 1), mk("src/a.txt", 1)}, 0)
		assertEmitted(t, s, []string{"link-dir/a.txt"})
	})
	t.Run("differentLinesBothKept", func(t *testing.T) {
		// Line 2 arrives first through the file link. The directory link's
		// copy of that line is the duplicate; line 1 is a different hit.
		s := runSymlinkHits(t, root, []rg.Match{
			mk("src/a.txt", 1),
			mk("link-file", 2),
			mk("link-dir/a.txt", 2),
		}, 0)
		assertEmitted(t, s, []string{"src/a.txt", "link-file"})
	})
	t.Run("outsideStillDropped", func(t *testing.T) {
		s := runSymlinkHits(t, root, []rg.Match{
			mk("src/b.txt", 1),
			mk("link-out/leak.txt", 1),
			mk("link-file", 1),
		}, 0)
		assertEmitted(t, s, []string{"src/b.txt", "link-file"})
	})
	t.Run("duplicateDoesNotConsumeMaxResults", func(t *testing.T) {
		s := runSymlinkHits(t, root, []rg.Match{
			mk("src/a.txt", 1),
			mk("link-file", 1),
			mk("link-dir/a.txt", 1),
			mk("src/b.txt", 1),
			mk("src/b.txt", 2),
		}, 2)
		assertEmitted(t, s, []string{"src/a.txt", "src/b.txt"})
		if s.done["truncated"] != true || s.done["cancelled"] != false {
			t.Fatalf("done = %v, want truncated and not cancelled", s.done)
		}
	})
}
