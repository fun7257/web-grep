package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"web-grep/internal/config"
	"web-grep/internal/logx"
)

func TestInfoLogsOmitSearchRoot(t *testing.T) {
	const (
		root    = "/var/lib/web-grep-fx2/search-root"
		cfgPath = "/var/lib/web-grep-fx2/config.yaml"
		token   = "sha256:deadbeef-token-hash"
	)
	cfg := config.Config{
		Host:       "127.0.0.1",
		Port:       18910,
		RootLabel:  "search-root",
		RootReal:   root,
		ConfigPath: cfgPath,
		TokenHash:  token,
		LogLevel:   "info",
	}

	var buf bytes.Buffer
	logx.SetOutput(&buf)
	t.Cleanup(func() {
		logx.SetOutput(nil)
		logx.SetLevel("info")
	})

	logx.SetLevel("info")
	logListening(cfg, "rg")
	logReloaded(cfg)
	logHashedToken(cfg)
	logSealTokenFailed(cfg, fmt.Errorf("open %s: permission denied", cfgPath))
	logReloadFailed(cfg, fmt.Errorf("root is not a readable directory: %s", root))
	const freshRoot = "/elsewhere/brand-new-root"
	logReloadFailed(cfg, fmt.Errorf("root is not a readable directory: %s", freshRoot))

	infoText := buf.String()
	if strings.Contains(infoText, root) || strings.Contains(infoText, freshRoot) {
		t.Fatalf("info logs contain search root:\n%s", infoText)
	}
	if strings.Contains(infoText, cfgPath) {
		t.Fatalf("info logs contain config path:\n%s", infoText)
	}
	if strings.Contains(infoText, token) || strings.Contains(infoText, `"query"`) {
		t.Fatalf("info logs contain a token or query:\n%s", infoText)
	}
	for _, msg := range []string{
		"listening",
		"reloaded config",
		"hashed token in config.yaml",
		"could not persist hashed token",
		"reload failed",
	} {
		if !strings.Contains(infoText, msg) {
			t.Fatalf("missing %q in\n%s", msg, infoText)
		}
	}
	assertNoAbsolutePaths(t, infoText, root, cfgPath)

	buf.Reset()
	logx.SetLevel("debug")
	logListening(cfg, "rg")
	logReloaded(cfg)
	logHashedToken(cfg)
	logReloadFailed(cfg, fmt.Errorf("root is not a readable directory: %s", root))
	debugText := buf.String()
	if !strings.Contains(debugText, root) {
		t.Fatalf("debug should keep the search root:\n%s", debugText)
	}
	if !strings.Contains(debugText, cfgPath) {
		t.Fatalf("debug should keep the config path:\n%s", debugText)
	}
	sawDebugRoot := false
	for _, line := range strings.Split(debugText, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line: %v %s", err, line)
		}
		lv, _ := rec["level"].(string)
		if lv == "debug" {
			if strings.Contains(line, root) {
				sawDebugRoot = true
			}
			continue
		}
		if lv != "info" && lv != "warn" && lv != "error" {
			t.Fatalf("unexpected level %q in %s", lv, line)
		}
		if strings.Contains(line, root) || strings.Contains(line, cfgPath) || strings.Contains(line, `"root":`) {
			t.Fatalf("%s line contains an absolute path: %s", lv, line)
		}
	}
	if !sawDebugRoot {
		t.Fatalf("debug lines did not keep the search root:\n%s", debugText)
	}
}

func assertNoAbsolutePaths(t *testing.T, raw, root, cfgPath string) {
	t.Helper()
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line: %v %s", err, line)
		}
		lv, _ := rec["level"].(string)
		if lv != "info" && lv != "warn" && lv != "error" {
			t.Fatalf("level %q should not be emitted: %s", lv, line)
		}
		if strings.Contains(line, root) || strings.Contains(line, cfgPath) || strings.Contains(line, `"root":`) {
			t.Fatalf("%s line contains an absolute path: %s", lv, line)
		}
		if _, ok := rec["rootLabel"]; ok && rec["rootLabel"] == "" {
			t.Fatalf("empty rootLabel: %s", line)
		}
	}
}
