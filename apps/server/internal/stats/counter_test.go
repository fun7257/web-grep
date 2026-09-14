package stats

import (
	"path/filepath"
	"sync"
	"testing"
)

func TestCounterAddIsSerialized(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search-count")
	c := Open(path)
	const workers = 32
	const each = 20
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < each; j++ {
				c.Add()
			}
		}()
	}
	wg.Wait()
	if got := c.Get(); got != workers*each {
		t.Fatalf("got %d want %d", got, workers*each)
	}
	again := Open(path)
	if got := again.Get(); got != workers*each {
		t.Fatalf("reload got %d", got)
	}
}
