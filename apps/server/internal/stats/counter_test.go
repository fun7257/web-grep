package stats

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestCounterAddIsSerialized(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search-count")
	c := OpenWithFlushEvery(path, 0)
	t.Cleanup(c.Close)
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
	c.Flush()
	again := OpenWithFlushEvery(path, 0)
	t.Cleanup(again.Close)
	if got := again.Get(); got != workers*each {
		t.Fatalf("reload got %d", got)
	}
}

func TestAddDoesNotWriteDiskOnCriticalPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search-count")
	c := OpenWithFlushEvery(path, time.Hour)
	t.Cleanup(c.Close)

	if got := c.Add(); got != 1 {
		t.Fatalf("Add=%d", got)
	}
	if c.Get() != 1 {
		t.Fatal("memory count missing")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("Add must not persist immediately, stat err=%v", err)
	}

	c.Flush()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "1\n" {
		t.Fatalf("flush wrote %q", raw)
	}
}

func TestCloseFlushesPendingCount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search-count")
	c := OpenWithFlushEvery(path, time.Hour)
	c.Add()
	c.Add()
	c.Close()
	again := OpenWithFlushEvery(path, 0)
	t.Cleanup(again.Close)
	if got := again.Get(); got != 2 {
		t.Fatalf("Close should persist, got %d", got)
	}
}

func TestPeriodicFlushPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search-count")
	c := OpenWithFlushEvery(path, 20*time.Millisecond)
	t.Cleanup(c.Close)
	c.Add()
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if raw, err := os.ReadFile(path); err == nil && string(raw) == "1\n" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("periodic flush did not persist")
}

func TestNilCounterIsNoop(t *testing.T) {
	var c *Counter
	if c.Add() != 0 || c.Get() != 0 {
		t.Fatal("nil counter")
	}
	c.Flush()
	c.Close()
}
