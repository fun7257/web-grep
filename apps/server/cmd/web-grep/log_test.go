package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"web-grep/internal/auth"
	"web-grep/internal/config"
	"web-grep/internal/httpapi"
	"web-grep/internal/logx"
	"web-grep/internal/ratelimit"
	"web-grep/internal/search"
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

func TestTokenAndPasswordStayOutOfLogs(t *testing.T) {
	const (
		password = "fx7-password-secret"
		wrong    = "fx7-wrong-password"
		bearer   = "fx7-bearer-token-secret"
	)
	root := t.TempDir()
	cfg := config.Config{
		Host:      "127.0.0.1",
		Port:      8787,
		RootReal:  root,
		RootLabel: "fixture-root",
		TokenHash: config.HashPassword(password),
		LogLevel:  "debug",
	}
	srv := &httpapi.Server{
		Search:   search.New(cfg, nil, "none", nil),
		Engine:   "none",
		Sessions: auth.NewSessions(),
		Reads:    ratelimit.New(),
	}
	srv.SetConfig(cfg)

	var buf bytes.Buffer
	logx.SetOutput(&buf)
	logx.SetLevel("debug")
	t.Cleanup(func() {
		logx.SetOutput(nil)
		logx.SetLevel("info")
	})

	h := srv.Handler()
	postLogin := func(pass string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]string{"password": pass})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8787/api/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	bad := postLogin(wrong)
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d %s", bad.Code, bad.Body.String())
	}
	ok := postLogin(password)
	if ok.Code != http.StatusOK {
		t.Fatalf("login: %d %s", ok.Code, ok.Body.String())
	}
	var sess struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(ok.Body.Bytes(), &sess); err != nil {
		t.Fatal(err)
	}
	if sess.Token == "" {
		t.Fatal("empty session token")
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8787/api/meta", nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad bearer: %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8787/api/meta", nil)
	req.Header.Set("Authorization", "Bearer "+sess.Token)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authed meta: %d %s", rec.Code, rec.Body.String())
	}

	text := buf.String()
	if !strings.Contains(text, "auth fail") {
		t.Fatalf("expected an auth failure log:\n%s", text)
	}
	for _, secret := range []string{password, wrong, bearer, sess.Token, cfg.TokenHash} {
		if strings.Contains(text, secret) {
			t.Fatalf("log contains %q:\n%s", secret, text)
		}
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
