package stats

import (
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultFlushEvery is how often a dirty counter is written to disk.
// Add() never waits on that write; Close()/Flush() make it durable.
const DefaultFlushEvery = 2 * time.Second

type Counter struct {
	mu     sync.Mutex
	n      uint64
	dirty  bool
	path   string
	stop   chan struct{}
	done   chan struct{}
	closed sync.Once
}

func Open(path string) *Counter {
	return OpenWithFlushEvery(path, DefaultFlushEvery)
}

// OpenWithFlushEvery is for tests. A non-positive interval disables the
// background flusher (Add still updates memory; call Flush or Close).
func OpenWithFlushEvery(path string, every time.Duration) *Counter {
	c := &Counter{path: path}
	c.load()
	if every > 0 {
		c.stop = make(chan struct{})
		c.done = make(chan struct{})
		go c.flushLoop(every)
	}
	return c
}

func (c *Counter) Get() uint64 {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}

// Add increments the in-memory count and returns it. Persistence is
// asynchronous (periodic flush and Close). The search hot path does not
// wait for disk.
func (c *Counter) Add() uint64 {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
	c.dirty = true
	return c.n
}

// Flush writes the current count if it has changed since the last save.
func (c *Counter) Flush() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.saveLocked()
}

// Close stops the background flusher and writes any pending count.
// Safe to call more than once; nil-safe.
func (c *Counter) Close() {
	if c == nil {
		return
	}
	c.closed.Do(func() {
		if c.stop != nil {
			close(c.stop)
			<-c.done
		}
		c.Flush()
	})
}

func (c *Counter) flushLoop(every time.Duration) {
	defer close(c.done)
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
			c.Flush()
		}
	}
}

func (c *Counter) load() {
	if c.path == "" {
		return
	}
	raw, err := os.ReadFile(c.path)
	if err != nil {
		return
	}
	n, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64)
	if err != nil {
		return
	}
	c.n = n
}

func (c *Counter) saveLocked() {
	if c.path == "" || !c.dirty {
		return
	}
	body := []byte(strconv.FormatUint(c.n, 10) + "\n")
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return
	}
	if err := os.Rename(tmp, c.path); err != nil {
		_ = os.WriteFile(c.path, body, 0o644)
		_ = os.Remove(tmp)
	}
	c.dirty = false
}
