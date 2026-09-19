package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeLoadConfig(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "root")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "config.yaml")
	text := "root: " + root + "\nhost: 127.0.0.1\n" + body
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	clearConfigEnv(t)
	return path
}

func TestLoadPreviewChunkDefaultsAndYAML(t *testing.T) {
	path := writeLoadConfig(t, "preview_lines: 88\n")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PreviewLines != 88 {
		t.Fatalf("preview_lines=%d", cfg.PreviewLines)
	}
	if cfg.PreviewChunk != PreviewChunk || cfg.PreviewChunkMax != PreviewChunkMax {
		t.Fatalf("defaults chunk=%d max=%d", cfg.PreviewChunk, cfg.PreviewChunkMax)
	}
	if cfg.FilePreviewCount() != PreviewChunk || cfg.FilePreviewCountMax() != PreviewChunkMax {
		t.Fatalf("effective count=%d max=%d", cfg.FilePreviewCount(), cfg.FilePreviewCountMax())
	}

	path = writeLoadConfig(t, "preview_chunk: 40\npreview_chunk_max: 90\npreview_lines: 201\n")
	cfg, err = Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PreviewChunk != 40 || cfg.PreviewChunkMax != 90 || cfg.PreviewLines != 201 {
		t.Fatalf("yaml: %+v", cfg)
	}
	if cfg.FilePreviewCount() != 40 || cfg.FilePreviewCountMax() != 90 {
		t.Fatalf("effective after yaml count=%d max=%d", cfg.FilePreviewCount(), cfg.FilePreviewCountMax())
	}
}

func TestLoadPreviewChunkEnvOverridesYAML(t *testing.T) {
	path := writeLoadConfig(t, "preview_chunk: 40\npreview_chunk_max: 90\npreview_lines: 77\n")
	t.Setenv(EnvPreviewChunk, "55")
	t.Setenv(EnvPreviewChunkMax, "70")
	t.Setenv(EnvPreviewLines, "12")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PreviewChunk != 55 || cfg.PreviewChunkMax != 70 || cfg.PreviewLines != 12 {
		t.Fatalf("env override: chunk=%d max=%d lines=%d", cfg.PreviewChunk, cfg.PreviewChunkMax, cfg.PreviewLines)
	}
}

func TestLoadPreviewChunkClampedToMax(t *testing.T) {
	path := writeLoadConfig(t, "preview_chunk: 500\npreview_chunk_max: 80\n")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PreviewChunk != 80 || cfg.PreviewChunkMax != 80 {
		t.Fatalf("clamp: chunk=%d max=%d", cfg.PreviewChunk, cfg.PreviewChunkMax)
	}
}

func TestLoadPreviewChunkInvalid(t *testing.T) {
	path := writeLoadConfig(t, "preview_chunk: 0\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "preview_chunk") {
		t.Fatalf("expected invalid preview_chunk, got %v", err)
	}
	path = writeLoadConfig(t, "preview_chunk_max: 0\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "preview_chunk_max") {
		t.Fatalf("expected invalid preview_chunk_max, got %v", err)
	}
}

func TestFilePreviewCountFallbackOnZeroConfig(t *testing.T) {
	cfg := Config{PreviewLines: 201}
	if cfg.FilePreviewCount() != PreviewChunk {
		t.Fatalf("count=%d", cfg.FilePreviewCount())
	}
	if cfg.FilePreviewCountMax() != PreviewChunkMax {
		t.Fatalf("max=%d", cfg.FilePreviewCountMax())
	}
	cfg.PreviewChunk = 50
	cfg.PreviewChunkMax = 20
	if cfg.FilePreviewCount() != 20 {
		t.Fatalf("count should clamp to max, got %d", cfg.FilePreviewCount())
	}
}
