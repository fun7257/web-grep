package stats

import (
	"os"
	"strconv"
	"strings"
	"sync"
)

type Counter struct {
	mu   sync.Mutex
	n    uint64
	path string
}

func Open(path string) *Counter {
	c := &Counter{path: path}
	c.load()
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

func (c *Counter) Add() uint64 {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
	c.saveLocked()
	return c.n
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
	if c.path == "" {
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
}
