package rg

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
	"testing"
	"time"
)

func fakeMatchJSON(text string, line int) string {
	q, err := json.Marshal(text + "\n")
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf(`{"type":"match","data":{"path":{"text":"a.txt"},"lines":{"text":%s},"line_number":%d,"submatches":[{"start":0,"end":1}]}}`, q, line)
}

// TestFilterEOFOnlyWrapperDoesNotDependOnStreaming uses a stand-in that
// reads a filter's entire stdin before invoking real rg. rg 15 behaves
// that way even with --line-buffered; the engine must still finish inside
// the watchdog and keep the line-text verdict.
func TestFilterEOFOnlyWrapperDoesNotDependOnStreaming(t *testing.T) {
	real := liveBin(t)
	wrapper := fakeRg(t, `real='`+real+`'
case " $* " in
*" --json "*)
  exec "$real" "$@"
  ;;
*)
  tmp=$(mktemp)
  cat > "$tmp"
  "$real" "$@" < "$tmp"
  st=$?
  rm -f "$tmp"
  exit $st
  ;;
esac
`)
	root := t.TempDir()
	writeRootFile(t, root, "a.txt", []byte("g one\ng two\n"))
	writeRootFile(t, root, "b.txt", []byte("g xyz\n"))
	writeRootFile(t, root, "dir/zzz.txt", []byte("g zzz\n"))
	writeRootFile(t, root, "c.txt", []byte("go go go\nnothing here\ngreat day\n"))
	// Pad past a pipe buffer so a filter that waits for EOF cannot be
	// unblocked by the kernel merely flushing a short write.
	var pad bytes.Buffer
	for i := 0; i < 4000; i++ {
		fmt.Fprintf(&pad, "g pad %d\n", i)
	}
	writeRootFile(t, root, "pad.txt", pad.Bytes())

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var got []string
	err := Engine{Bin: wrapper}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "i"}},
	}, func(m Match) error {
		got = append(got, strings.TrimRight(m.Text, "\r\n"))
		return nil
	}, nil)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("search did not return inside the watchdog; it is waiting on rg to stream")
	}
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "nothing here" {
		t.Fatalf("got %v, want only \"nothing here\"", got)
	}
}

// TestFilterSlowHeadFlushesBeforeEOF is a head that pauses between matches.
// idleFlush / maxBatchAge must emit the early hit before the head finishes.
func TestFilterSlowHeadFlushesBeforeEOF(t *testing.T) {
	real := liveBin(t)
	first := fakeMatchJSON("g one", 1)
	second := fakeMatchJSON("g two", 2)
	wrapper := fakeRg(t, `real='`+real+`'
case " $* " in
*" --json "*)
  printf '%s\n' '`+first+`'
  sleep 1.5
  printf '%s\n' '`+second+`'
  ;;
*)
  exec "$real" "$@"
  ;;
esac
`)
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	start := time.Now()
	var got []string
	var at []time.Duration
	err := Engine{Bin: wrapper}.Search(ctx, Input{
		RootReal:    t.TempDir(),
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "g"}},
	}, func(m Match) error {
		at = append(at, time.Since(start))
		got = append(got, strings.TrimRight(m.Text, "\r\n"))
		return nil
	}, nil)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("slow head search hung")
	}
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "g one|g two" {
		t.Fatalf("got %v", got)
	}
	if len(at) != 2 {
		t.Fatalf("emit times %v", at)
	}
	t.Logf("first=%s second=%s gap=%s", at[0], at[1], at[1]-at[0])
	// The head sleeps 1.5s before the second line. A flush that waits for
	// EOF emits both after that sleep. idle/age must beat that, with room
	// for a slow scheduler.
	if at[0] >= time.Second {
		t.Fatalf("first hit at %s, want it before the head's 1.5s pause ends", at[0])
	}
	if at[1]-at[0] < 800*time.Millisecond {
		t.Fatalf("gap %s, both hits were held until the head finished", at[1]-at[0])
	}
}

func TestFilterBatchHitBoundaries(t *testing.T) {
	bin := liveBin(t)
	for _, n := range []int{maxBatchHits - 1, maxBatchHits, maxBatchHits + 1} {
		t.Run(fmt.Sprintf("n=%d", n), func(t *testing.T) {
			root := t.TempDir()
			var body bytes.Buffer
			for i := 0; i < n; i++ {
				fmt.Fprintf(&body, "g %d\n", i)
			}
			writeRootFile(t, root, "a.txt", body.Bytes())
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			var got []string
			err := Engine{Bin: bin}.Search(ctx, Input{
				RootReal:    root,
				RelativeDir: ".",
				Query:       "g",
				NoIgnore:    true,
				FilterTerms: []FilterTerm{{Query: "g"}},
			}, func(m Match) error {
				got = append(got, strings.TrimRight(m.Text, "\r\n"))
				return nil
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != n {
				t.Fatalf("hits=%d want %d", len(got), n)
			}
			for i, text := range got {
				want := fmt.Sprintf("g %d", i)
				if text != want {
					t.Fatalf("hit %d = %q, want %q", i, text, want)
				}
			}
		})
	}
}

func TestFilterCrossBatchOrderAndAND(t *testing.T) {
	bin := liveBin(t)
	const n = maxBatchHits + 3
	root := t.TempDir()
	var body bytes.Buffer
	var want []string
	for i := 0; i < n; i++ {
		if i%2 == 0 {
			fmt.Fprintf(&body, "g keep %d\n", i)
			want = append(want, fmt.Sprintf("g keep %d", i))
		} else {
			fmt.Fprintf(&body, "g drop %d\n", i)
		}
	}
	writeRootFile(t, root, "a.txt", body.Bytes())
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var got []string
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "g"}, {Query: "keep"}},
	}, func(m Match) error {
		got = append(got, strings.TrimRight(m.Text, "\r\n"))
		return nil
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("hits=%d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("hit %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func fixedMatchLine(i, width int) []byte {
	// width is the payload size, including the trailing newline.
	prefix := fmt.Sprintf("g %d ", i)
	if len(prefix) >= width {
		panic(prefix)
	}
	b := bytes.Repeat([]byte("x"), width-1)
	copy(b, prefix)
	b = append(b, '\n')
	return b
}

func TestFilterBatchByteBoundaries(t *testing.T) {
	bin := liveBin(t)
	const width = 1024
	if maxBatchBytes%width != 0 {
		t.Fatalf("maxBatchBytes %d not divisible by %d", maxBatchBytes, width)
	}
	exact := maxBatchBytes / width
	for _, n := range []int{exact - 1, exact, exact + 1} {
		t.Run(fmt.Sprintf("n=%d", n), func(t *testing.T) {
			root := t.TempDir()
			var body bytes.Buffer
			for i := 0; i < n; i++ {
				body.Write(fixedMatchLine(i, width))
			}
			writeRootFile(t, root, "a.txt", body.Bytes())
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			var got []int
			err := Engine{Bin: bin}.Search(ctx, Input{
				RootReal:    root,
				RelativeDir: ".",
				Query:       "g",
				NoIgnore:    true,
				FilterTerms: []FilterTerm{{Query: "g"}},
			}, func(m Match) error {
				var id int
				if _, err := fmt.Sscanf(m.Text, "g %d", &id); err != nil {
					t.Fatalf("text %q: %v", m.Text, err)
				}
				got = append(got, id)
				return nil
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != n {
				t.Fatalf("hits=%d want %d", len(got), n)
			}
			for i, id := range got {
				if id != i {
					t.Fatalf("hit %d id=%d", i, id)
				}
			}
		})
	}
}

func TestFilterOversizedLineIsOwnBatch(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	var body bytes.Buffer
	body.WriteString("g head\n")
	big := fixedMatchLine(1, maxBatchBytes+128)
	body.Write(big)
	body.WriteString("g tail\n")
	writeRootFile(t, root, "a.txt", body.Bytes())
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var got []string
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "g"}, {Query: "g", CaseSensitive: true}},
	}, func(m Match) error {
		text := strings.TrimRight(m.Text, "\r\n")
		if len(text) > 40 {
			text = text[:40]
		}
		got = append(got, text)
		return nil
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("hits=%d %v", len(got), got)
	}
	if got[0] != "g head" || !strings.HasPrefix(got[1], "g 1 ") || got[2] != "g tail" {
		t.Fatalf("got %q", got)
	}
}

func TestFilterInvalidRegexWithNoHits(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "a.txt", []byte("hello\n"))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	start := time.Now()
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "no-such-needle",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "(", Regex: true}},
	}, func(Match) error { return nil }, nil)
	elapsed := time.Since(start)
	t.Logf("elapsed=%s err=%v", elapsed, err)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("invalid filter with no upstream hits hung")
	}
	if elapsed > time.Second {
		t.Fatalf("elapsed %s, want a fast ENGINE error", elapsed)
	}
	if err == nil || !strings.Contains(err.Error(), "regex parse error") {
		t.Fatalf("err=%v, want regex parse error", err)
	}
}

func TestFilterNULByteInLineIsKept(t *testing.T) {
	// A tree search without -a skips a file that contains NUL (rg searches
	// zero bytes and emits no match). The head stays that way: binary files
	// are not forced through. The filter still has to judge a line whose
	// raw bytes contain NUL. rg -a --json emits that line as lines.text
	// with an embedded NUL; without -a on the filter, passthru prints
	// nothing and the count check fails. The head here is a stub that
	// emits one such record. The filter is the real rg.
	real := liveBin(t)
	line := fakeMatchJSON("g\x00x", 2)
	wrapper := fakeRg(t, `real='`+real+`'
case " $* " in
*" --json "*)
  printf '%s\n' '`+line+`'
  ;;
*)
  exec "$real" "$@"
  ;;
esac
`)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var lines []int
	var texts []string
	err := Engine{Bin: wrapper}.Search(ctx, Input{
		RootReal:    t.TempDir(),
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "x"}},
	}, func(m Match) error {
		lines = append(lines, m.Line)
		texts = append(texts, m.Text)
		return nil
	}, nil)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("NUL line hung the filter")
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 1 || lines[0] != 2 {
		t.Fatalf("lines=%v texts=%q, want line 2", lines, texts)
	}
	if !bytes.Contains([]byte(texts[0]), []byte{'g', 0, 'x'}) {
		t.Fatalf("text=%q, want the NUL byte preserved", texts[0])
	}
}

func TestFilterResourcesReleased(t *testing.T) {
	bin := liveBin(t)
	root := t.TempDir()
	writeRootFile(t, root, "a.txt", bytes.Repeat([]byte("g line\n"), 200))
	beforeG := runtime.NumGoroutine()
	beforeFD := countSelfFD(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    root,
		RelativeDir: ".",
		Query:       "g",
		NoIgnore:    true,
		FilterTerms: []FilterTerm{{Query: "line"}, {Query: "nope"}},
	}, func(Match) error { return nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	if kids := childProcesses(); kids != 0 {
		t.Fatalf("child processes still alive: %d", kids)
	}
	afterFD := countSelfFD(t)
	if afterFD > beforeFD {
		t.Fatalf("fds %d -> %d", beforeFD, afterFD)
	}
	afterG := runtime.NumGoroutine()
	if afterG > beforeG {
		t.Fatalf("goroutines %d -> %d", beforeG, afterG)
	}
}

func countSelfFD(t *testing.T) int {
	t.Helper()
	ents, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatal(err)
	}
	return len(ents)
}

func childProcesses() int {
	self := os.Getpid()
	ents, err := os.ReadDir("/proc")
	if err != nil {
		return -1
	}
	n := 0
	for _, e := range ents {
		pid := e.Name()
		if pid == "" || pid[0] < '0' || pid[0] > '9' {
			continue
		}
		b, err := os.ReadFile(filepath.Join("/proc", pid, "stat"))
		if err != nil {
			continue
		}
		// pid (comm) state ppid ...
		rest := string(b)
		closeParen := strings.LastIndex(rest, ")")
		if closeParen < 0 || closeParen+2 >= len(rest) {
			continue
		}
		fields := strings.Fields(rest[closeParen+2:])
		if len(fields) < 2 {
			continue
		}
		var ppid int
		if _, err := fmt.Sscanf(fields[1], "%d", &ppid); err != nil {
			continue
		}
		if ppid == self {
			n++
		}
	}
	return n
}
