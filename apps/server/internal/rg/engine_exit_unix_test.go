//go:build unix

package rg

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Killing the filter process must fail the search. A batch is handed to rg
// as a finished stdin, so the failure is the process dying, not a pipe write
// into a long-lived filter.
func TestFilterKilledProcessIsError(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	bin := fakeRg(t, `pidfile='`+pidFile+`'
case "$*" in
*--json*)
  printf '%s\n' '`+matchLine+`'
  ;;
*)
  tmp=$(mktemp)
  cat > "$tmp"
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    exit 1
  fi
  rm -f "$tmp"
  echo $$ > "$pidfile"
  # Replace the shell so the pid in the file is the process holding the
  # pipes. A child sleep would keep stdout open after the shell died.
  exec sleep 30
  ;;
esac
`)
	t.Cleanup(func() {
		b, err := os.ReadFile(pidFile)
		if err != nil {
			return
		}
		pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
		if err != nil {
			return
		}
		_ = syscall.Kill(pid, syscall.SIGKILL)
	})
	go func() {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			b, err := os.ReadFile(pidFile)
			if err != nil {
				time.Sleep(5 * time.Millisecond)
				continue
			}
			pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
			if err != nil {
				return
			}
			_ = syscall.Kill(pid, syscall.SIGTERM)
			return
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var n int
	err := Engine{Bin: bin}.Search(ctx, Input{
		RootReal:    t.TempDir(),
		RelativeDir: ".",
		Query:       "hello",
		FilterTerms: []FilterTerm{{Query: "hello"}},
	}, func(Match) error { n++; return nil }, nil)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("search hung after the filter process was killed; emitted %d", n)
	}
	if err == nil {
		t.Fatalf("killing the filter process returned success; emitted %d", n)
	}
	if n != 0 {
		t.Fatalf("emitted %d matches after the filter process was killed", n)
	}
}
