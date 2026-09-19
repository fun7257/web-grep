package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"web-grep/internal/config"
)

type fileWindow struct {
	StartLine int  `json:"startLine"`
	LineCount int  `json:"lineCount"`
	Eof       bool `json:"eof"`
	Lines     []struct {
		N    int    `json:"n"`
		Text string `json:"text"`
	} `json:"lines"`
}

func writeNumberedFile(t *testing.T, path string, n int) {
	t.Helper()
	var body []byte
	for i := 1; i <= n; i++ {
		body = append(body, fmt.Sprintf("line-%d\n", i)...)
	}
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
}

func getFileWindow(t *testing.T, s *Server, query string) fileWindow {
	t.Helper()
	rec := do(t, s.Handler(), "GET", "http://127.0.0.1:8787/api/file?"+query, "", nil)
	if rec.Code != 200 {
		t.Fatalf("%s: %d %s", query, rec.Code, rec.Body.String())
	}
	var win fileWindow
	if err := json.Unmarshal(rec.Body.Bytes(), &win); err != nil {
		t.Fatal(err)
	}
	return win
}

func TestPinPreviewChunkChangesDefaultFileCount(t *testing.T) {
	s, root := testServer(t, nil)
	writeNumberedFile(t, filepath.Join(root, "ok.txt"), 200)

	cfg := s.Config()
	cfg.PreviewChunk = 40
	cfg.PreviewChunkMax = 400
	cfg.PreviewLines = 201
	s.SetConfig(cfg)

	win := getFileWindow(t, s, "path=ok.txt&from=1")
	if win.LineCount != 40 {
		t.Fatalf("preview_chunk=40 should be default count, got lineCount=%d start=%d", win.LineCount, win.StartLine)
	}
	if win.StartLine != 1 || win.Lines[0].N != 1 || win.Lines[39].N != 40 {
		t.Fatalf("window %+v", win)
	}

	meta := do(t, s.Handler(), "GET", "http://127.0.0.1:8787/api/meta", "", nil)
	if meta.Code != 200 {
		t.Fatal(meta.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(meta.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	limits, _ := body["limits"].(map[string]any)
	if limits["previewChunk"] != float64(40) {
		t.Fatalf("meta previewChunk=%v", limits["previewChunk"])
	}
	if limits["previewChunkMax"] != float64(400) {
		t.Fatalf("meta previewChunkMax=%v", limits["previewChunkMax"])
	}
	if limits["previewLines"] != float64(201) {
		t.Fatalf("compat previewLines=%v", limits["previewLines"])
	}
}

func TestPinPreviewLinesDoesNotChangeFilePull(t *testing.T) {
	s, root := testServer(t, nil)
	writeNumberedFile(t, filepath.Join(root, "ok.txt"), 200)

	cfg := s.Config()
	cfg.PreviewChunk = 40
	cfg.PreviewChunkMax = 400
	cfg.PreviewLines = 12
	s.SetConfig(cfg)

	omitted := getFileWindow(t, s, "path=ok.txt&from=1")
	if omitted.LineCount != 40 {
		t.Fatalf("preview_lines must not change default file count, got %d", omitted.LineCount)
	}

	explicit := getFileWindow(t, s, "path=ok.txt&from=1&count=20")
	if explicit.LineCount != 20 {
		t.Fatalf("explicit count should win, got %d", explicit.LineCount)
	}

	cfg.PreviewLines = 201
	s.SetConfig(cfg)
	again := getFileWindow(t, s, "path=ok.txt&from=1")
	if again.LineCount != omitted.LineCount {
		t.Fatalf("changing preview_lines changed file pull: %d vs %d", again.LineCount, omitted.LineCount)
	}
}

func TestPinPreviewChunkMaxClampsFileCount(t *testing.T) {
	s, root := testServer(t, nil)
	writeNumberedFile(t, filepath.Join(root, "ok.txt"), 200)

	cfg := s.Config()
	cfg.PreviewChunk = 160
	cfg.PreviewChunkMax = 25
	cfg.PreviewLines = 201
	s.SetConfig(cfg)

	clamped := getFileWindow(t, s, "path=ok.txt&from=1&count=100")
	if clamped.LineCount != 25 {
		t.Fatalf("count=100 should clamp to preview_chunk_max=25, got %d", clamped.LineCount)
	}

	under := getFileWindow(t, s, "path=ok.txt&from=1&count=10")
	if under.LineCount != 10 {
		t.Fatalf("count under max should pass through, got %d", under.LineCount)
	}

	def := getFileWindow(t, s, "path=ok.txt&from=1")
	if def.LineCount != 25 {
		t.Fatalf("default preview_chunk=160 should clamp to max 25, got %d", def.LineCount)
	}

	meta := do(t, s.Handler(), "GET", "http://127.0.0.1:8787/api/meta", "", nil)
	var body map[string]any
	if err := json.Unmarshal(meta.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	limits, _ := body["limits"].(map[string]any)
	if limits["previewChunkMax"] != float64(25) {
		t.Fatalf("meta previewChunkMax=%v", limits["previewChunkMax"])
	}
}

func TestPinPreviewChunkDefaultWhenUnsetMatchesHardcodedDefault(t *testing.T) {
	s, root := testServer(t, nil)
	writeNumberedFile(t, filepath.Join(root, "ok.txt"), 200)
	// testServer leaves PreviewChunk/Max at 0; helpers must fall back to 160/400.
	win := getFileWindow(t, s, "path=ok.txt&from=1")
	if win.LineCount != config.PreviewChunk {
		t.Fatalf("unset preview_chunk should default to %d, got %d", config.PreviewChunk, win.LineCount)
	}
}
