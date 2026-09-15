package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"web-grep/internal/auth"
	"web-grep/internal/config"
)

func TestAuthLoginAndGuard(t *testing.T) {
	s, _ := testServer(t, nil)
	s.Cfg.TokenHash = config.HashPassword("secret1")
	s.Sessions = auth.NewSessions()
	h := s.Handler()

	st := do(t, h, "GET", "http://127.0.0.1:8787/api/auth/status", "", nil)
	if st.Code != 200 {
		t.Fatal(st.Body.String())
	}
	var status struct {
		AuthRequired bool `json:"authRequired"`
	}
	if err := json.Unmarshal(st.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if !status.AuthRequired {
		t.Fatalf("%+v", status)
	}

	tree := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if tree.Code != 401 {
		t.Fatalf("tree before login: %d %s", tree.Code, tree.Body.String())
	}

	bad := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/login",
		`{"password":"nope-nope"}`, nil)
	if bad.Code != 401 {
		t.Fatalf("bad login: %d %s", bad.Code, bad.Body.String())
	}

	login := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/login",
		`{"password":"secret1"}`, nil)
	if login.Code != 200 {
		t.Fatal(login.Body.String())
	}
	var sess struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &sess); err != nil {
		t.Fatal(err)
	}
	if sess.Token == "" {
		t.Fatal("empty session")
	}

	ok := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + sess.Token,
	})
	if ok.Code != 200 {
		t.Fatal(ok.Body.String())
	}

	loggedOut := do(t, h, "POST", "http://127.0.0.1:8787/api/auth/logout", "", map[string]string{
		"Authorization": "Bearer " + sess.Token,
	})
	if loggedOut.Code != 200 {
		t.Fatal(loggedOut.Body.String())
	}
	after := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", map[string]string{
		"Authorization": "Bearer " + sess.Token,
	})
	if after.Code != 401 {
		t.Fatalf("tree after logout: %d %s", after.Code, after.Body.String())
	}
}

func TestSpaIsPublicWhenPasswordAuthIsOn(t *testing.T) {
	s, _ := testServer(t, nil)
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html>login"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("window.app=1"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.Cfg.TokenHash = config.HashPassword("secret1")
	s.Sessions = auth.NewSessions()
	s.WebDist = dir
	h := s.Handler()

	idx := do(t, h, "GET", "http://127.0.0.1:8787/", "", nil)
	if idx.Code != 200 || !strings.Contains(idx.Body.String(), "login") {
		t.Fatalf("spa index: %d %s", idx.Code, idx.Body.String())
	}
	js := do(t, h, "GET", "http://127.0.0.1:8787/assets/app.js", "", nil)
	if js.Code != 200 || !strings.Contains(js.Body.String(), "window.app") {
		t.Fatalf("spa asset: %d %s", js.Code, js.Body.String())
	}
	tree := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if tree.Code != 401 {
		t.Fatalf("tree should still require a session: %d", tree.Code)
	}
}

func TestAuthOptionalOnLoopbackWithoutToken(t *testing.T) {
	s, _ := testServer(t, nil)
	h := s.Handler()
	st := do(t, h, "GET", "http://127.0.0.1:8787/api/auth/status", "", nil)
	if st.Code != 200 {
		t.Fatal(st.Body.String())
	}
	tree := do(t, h, "GET", "http://127.0.0.1:8787/api/tree", "", nil)
	if tree.Code != 200 {
		t.Fatalf("tree without token: %d %s", tree.Code, tree.Body.String())
	}
}
