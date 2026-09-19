package httpapi

import (
	"fmt"
	"net/http"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
	"web-grep/internal/search"
)

type Server struct {
	Cfg      config.Config
	Search   *search.Service
	Engine   string
	Version  string
	WebDist  string
	Sessions *auth.Sessions
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/auth/status", s.authStatus)
	mux.HandleFunc("POST /api/auth/login", s.authLogin)
	mux.HandleFunc("POST /api/auth/logout", s.authLogout)
	mux.HandleFunc("GET /api/meta", s.meta)
	mux.HandleFunc("POST /api/search", s.search)
	mux.HandleFunc("GET /api/file", s.file)
	mux.HandleFunc("GET /api/tree", s.tree)
	mux.HandleFunc("GET /api/count", s.count)
	if s.WebDist != "" {
		mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, http.StatusNotFound, "INTERNAL", "not found")
		})
		mux.Handle("GET /", spa(s.WebDist, func() string { return s.Cfg.PublicPath }))
	}
	return auth.Middleware(func() config.Config { return s.Cfg }, s.Sessions)(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "engine": s.Engine})
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request) {
	var rgVersion any
	if s.Version != "" {
		rgVersion = s.Version
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"engine":         s.Engine,
		"rgVersion":      rgVersion,
		"rootLabel":      s.Cfg.RootLabel,
		"root":           s.Cfg.RootReal,
		"followSymlinks": s.Cfg.FollowSymlinks,
		"limits": map[string]any{
			"maxResults":     s.Cfg.MaxResults,
			"maxResultsHard": s.Cfg.MaxResultsHard,
			"timeoutMs":      s.Cfg.TimeoutMs,
			"previewBytes":   s.Cfg.PreviewBytes,
			"previewLines":   s.Cfg.PreviewLines,
			"queryMaxChars":  config.QueryMaxChars,
		},
		"defaultLocale": "zh-CN",
		"authRequired":  s.Cfg.TokenHash != "",
		"searchCount":   s.Search.Stats.Get(),
	})
}

func ListenAndServe(s *Server) error {
	addr := fmt.Sprintf("%s:%d", s.Cfg.Host, s.Cfg.Port)
	hs := &http.Server{
		Addr:              addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return hs.ListenAndServe()
}
