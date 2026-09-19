package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadReadLimitDefaultsAndYAML(t *testing.T) {
	path := writeLoadConfig(t, "")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReadMaxConcurrent != ReadMaxConcurrentDefault ||
		cfg.ReadRateLimit != ReadRateLimitDefault ||
		cfg.ReadRateWindowMs != ReadRateWindowMsDefault {
		t.Fatalf("defaults: conc=%d rate=%d window=%d", cfg.ReadMaxConcurrent, cfg.ReadRateLimit, cfg.ReadRateWindowMs)
	}
	if cfg.EffectiveReadMaxConcurrent() != ReadMaxConcurrentDefault ||
		cfg.EffectiveReadRateLimit() != ReadRateLimitDefault ||
		cfg.EffectiveReadRateWindow() != time.Duration(ReadRateWindowMsDefault)*time.Millisecond {
		t.Fatalf("effective defaults %+v", cfg)
	}

	path = writeLoadConfig(t, "read_max_concurrent: 4\nread_rate_limit: 7\nread_rate_window_ms: 2000\n")
	cfg, err = Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReadMaxConcurrent != 4 || cfg.ReadRateLimit != 7 || cfg.ReadRateWindowMs != 2000 {
		t.Fatalf("yaml: conc=%d rate=%d window=%d", cfg.ReadMaxConcurrent, cfg.ReadRateLimit, cfg.ReadRateWindowMs)
	}
	if cfg.EffectiveReadRateLimit() != 7 {
		t.Fatalf("effective rate=%d", cfg.EffectiveReadRateLimit())
	}
}

func TestLoadReadLimitEnvOverridesYAML(t *testing.T) {
	path := writeLoadConfig(t, "read_max_concurrent: 4\nread_rate_limit: 7\nread_rate_window_ms: 2000\n")
	t.Setenv(EnvReadMaxConcurrent, "16")
	t.Setenv(EnvReadRateLimit, "9")
	t.Setenv(EnvReadRateWindowMs, "1500")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReadMaxConcurrent != 16 || cfg.ReadRateLimit != 9 || cfg.ReadRateWindowMs != 1500 {
		t.Fatalf("env override: conc=%d rate=%d window=%d", cfg.ReadMaxConcurrent, cfg.ReadRateLimit, cfg.ReadRateWindowMs)
	}
}

func TestLoadReadLimitInvalid(t *testing.T) {
	path := writeLoadConfig(t, "read_max_concurrent: 0\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "read_max_concurrent") {
		t.Fatalf("expected invalid read_max_concurrent, got %v", err)
	}
	path = writeLoadConfig(t, "read_rate_limit: 0\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "read_rate_limit") {
		t.Fatalf("expected invalid read_rate_limit, got %v", err)
	}
	path = writeLoadConfig(t, "read_rate_window_ms: 10\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "read_rate_window_ms") {
		t.Fatalf("expected invalid read_rate_window_ms, got %v", err)
	}
}

func TestEffectiveReadLimitsFallbackOnZeroConfig(t *testing.T) {
	cfg := Config{}
	if cfg.EffectiveReadMaxConcurrent() != ReadMaxConcurrentDefault {
		t.Fatalf("conc=%d", cfg.EffectiveReadMaxConcurrent())
	}
	if cfg.EffectiveReadRateLimit() != ReadRateLimitDefault {
		t.Fatalf("rate=%d", cfg.EffectiveReadRateLimit())
	}
	if cfg.EffectiveReadRateWindow() != time.Duration(ReadRateWindowMsDefault)*time.Millisecond {
		t.Fatalf("window=%s", cfg.EffectiveReadRateWindow())
	}
	cfg.ReadMaxConcurrent = 3
	cfg.ReadRateLimit = 5
	cfg.ReadRateWindowMs = 2500
	if cfg.EffectiveReadMaxConcurrent() != 3 || cfg.EffectiveReadRateLimit() != 5 {
		t.Fatalf("set values: conc=%d rate=%d", cfg.EffectiveReadMaxConcurrent(), cfg.EffectiveReadRateLimit())
	}
	if cfg.EffectiveReadRateWindow() != 2500*time.Millisecond {
		t.Fatalf("window=%s", cfg.EffectiveReadRateWindow())
	}
}
