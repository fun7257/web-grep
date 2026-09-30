package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"web-grep/internal/auth"
	"web-grep/internal/config"
)

func requireJSONCode(t *testing.T, rec *httptest.ResponseRecorder, status int, code, message string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, want %d; body %s", rec.Code, status, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %s: %v", rec.Body.String(), err)
	}
	if body["code"] != code || body["message"] != message {
		t.Fatalf("got code=%q message=%q, want %q %q", body["code"], body["message"], code, message)
	}
}

func TestUnknownAPIRouteNotFound(t *testing.T) {
	s, _ := testServer(t, nil)
	h := s.Handler()
	for _, path := range []string{"/api/nope", "/api/不存在", "/api/count"} {
		rec := do(t, h, "GET", "http://127.0.0.1:8787"+path, "", nil)
		requireJSONCode(t, rec, http.StatusNotFound, "NOT_FOUND", "not found")
	}

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html>ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.WebDist = dir
	h = s.Handler()
	requireJSONCode(t, do(t, h, "GET", "http://127.0.0.1:8787/api/nope", "", nil), http.StatusNotFound, "NOT_FOUND", "not found")
	fallback := do(t, h, "GET", "http://127.0.0.1:8787/missing", "", nil)
	if fallback.Code != http.StatusOK || !strings.Contains(fallback.Body.String(), "ok") {
		t.Fatalf("spa fallback: %d %s", fallback.Code, fallback.Body.String())
	}
}

func TestUnknownAPIRouteUnauthorizedBeforeNotFound(t *testing.T) {
	s, _ := testServer(t, nil)
	cfg := s.Config()
	cfg.TokenHash = config.HashPassword("secret1")
	s.SetConfig(cfg)
	s.Sessions = auth.NewSessions()
	h := s.Handler()

	rec := do(t, h, "GET", "http://127.0.0.1:8787/api/nope", "", nil)
	requireJSONCode(t, rec, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid session")

	login := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/login", `{"password":"secret1"}`, nil)
	if login.Code != http.StatusOK {
		t.Fatal(login.Body.String())
	}
	var sess struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &sess); err != nil {
		t.Fatal(err)
	}
	authed := do(t, h, "GET", "http://127.0.0.1:8787/api/nope", "", map[string]string{
		"Authorization": "Bearer " + sess.Token,
	})
	requireJSONCode(t, authed, http.StatusNotFound, "NOT_FOUND", "not found")
}

func TestTreeAndFileErrorsStayInvalidPath(t *testing.T) {
	s, root := testServer(t, nil)
	if err := os.Mkdir(filepath.Join(root, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	requireJSONCode(t, do(t, h, "GET", "http://127.0.0.1:8787/api/tree?path=../etc", "", nil), http.StatusNotFound, "INVALID_PATH", "invalid path")
	requireJSONCode(t, do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=../etc", "", nil), http.StatusNotFound, "INVALID_PATH", "invalid path")
	requireJSONCode(t, do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=no-such.txt", "", nil), http.StatusNotFound, "INVALID_PATH", "invalid path")
	requireJSONCode(t, do(t, h, "GET", "http://127.0.0.1:8787/api/file?path=subdir", "", nil), http.StatusBadRequest, "INVALID_PATH", "not a file")
}

func TestMethodNotAllowedStaysPlain(t *testing.T) {
	s, _ := testServer(t, nil)
	h := s.Handler()
	for _, target := range []string{"/api/health", "/api/nope"} {
		rec := do(t, h, "POST", "http://127.0.0.1:8787"+target, "", nil)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s: %d %s", target, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), `"code"`) {
			t.Fatalf("POST %s body should stay without a code, got %s", target, rec.Body.String())
		}
	}
}
