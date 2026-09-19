package config

import "sync/atomic"

// StoreSnapshot publishes a complete Config value. Concurrent LoadSnapshot
// callers always observe either the previous or the next snapshot, never a
// mix of fields from both (SIGHUP / reload must not tear).
func StoreSnapshot(p *atomic.Pointer[Config], cfg Config) {
	if p == nil {
		return
	}
	next := cloneConfig(cfg)
	p.Store(&next)
}

// LoadSnapshot returns a consistent Config copy. A nil or empty pointer
// yields the zero Config.
func LoadSnapshot(p *atomic.Pointer[Config]) Config {
	if p == nil {
		return Config{}
	}
	got := p.Load()
	if got == nil {
		return Config{}
	}
	return cloneConfig(*got)
}

func cloneConfig(cfg Config) Config {
	if cfg.PublicHosts != nil {
		cfg.PublicHosts = append([]string(nil), cfg.PublicHosts...)
	}
	return cfg
}
