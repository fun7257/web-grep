package config

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestSnapshotSwapConsistentUnderRace(t *testing.T) {
	var box atomic.Pointer[Config]
	StoreSnapshot(&box, Config{RootLabel: "a", RootReal: "/a", MaxResults: 1, TokenHash: "ha"})

	var writers sync.WaitGroup
	writers.Add(4)
	done := make(chan struct{})
	var readers sync.WaitGroup
	readers.Add(8)

	for i := 0; i < 4; i++ {
		go func() {
			defer writers.Done()
			for n := 0; n < 2000; n++ {
				if n%2 == 0 {
					StoreSnapshot(&box, Config{RootLabel: "a", RootReal: "/a", MaxResults: 1, TokenHash: "ha"})
				} else {
					StoreSnapshot(&box, Config{RootLabel: "b", RootReal: "/b", MaxResults: 2, TokenHash: "hb"})
				}
			}
		}()
	}
	errCh := make(chan Config, 1)
	for i := 0; i < 8; i++ {
		go func() {
			defer readers.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				got := LoadSnapshot(&box)
				a := got.RootLabel == "a" && got.RootReal == "/a" && got.MaxResults == 1 && got.TokenHash == "ha"
				b := got.RootLabel == "b" && got.RootReal == "/b" && got.MaxResults == 2 && got.TokenHash == "hb"
				if !a && !b {
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
		t.Fatalf("torn snapshot: %+v", got)
	default:
	}
}

func TestLoadSnapshotEmpty(t *testing.T) {
	if got := LoadSnapshot(nil); got.RootReal != "" {
		t.Fatalf("%+v", got)
	}
	var box atomic.Pointer[Config]
	if got := LoadSnapshot(&box); got.MaxResults != 0 {
		t.Fatalf("%+v", got)
	}
}
