package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"web-grep/internal/auth"
	"web-grep/internal/config"
)

type loginBody struct {
	Password string `json:"password"`
}

func (s *Server) authStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"authRequired": s.Config().TokenHash != "",
	})
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	cfg := s.Config()
	if cfg.TokenHash == "" || s.Sessions == nil {
		writeErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "auth is not enabled")
		return
	}
	body, ok := readLoginBody(w, r)
	if !ok {
		return
	}
	if !config.PasswordMatches(cfg.TokenHash, body.Password) {
		writeErr(w, http.StatusUnauthorized, "INVALID_AUTH", "invalid password")
		return
	}
	token, err := s.Sessions.Issue()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "could not issue session")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token})
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	if s.Sessions != nil {
		s.Sessions.Revoke(auth.ExtractToken(r))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func readLoginBody(w http.ResponseWriter, r *http.Request) (loginBody, bool) {
	var body loginBody
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<16))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_AUTH", "invalid request")
		return loginBody{}, false
	}
	body.Password = strings.TrimSpace(body.Password)
	if body.Password == "" {
		writeErr(w, http.StatusBadRequest, "INVALID_AUTH", "password is required")
		return loginBody{}, false
	}
	return body, true
}
