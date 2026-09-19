package httpapi

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
	"web-grep/internal/ratelimit"
	"web-grep/internal/search"
)

type Server struct {
	cfg      atomic.Pointer[config.Config]
	Search   *search.Service
	Engine   string
	Version  string
	WebDist  string
	Sessions *auth.Sessions
	Reads    *ratelimit.Limiter
}

// Config returns a consistent snapshot. Concurrent SetConfig swaps are
// atomic; handlers never observe mixed old/new fields.
func (s *Server) Config() config.Config {
	return config.LoadSnapshot(&s.cfg)
}

func (s *Server) SetConfig(cfg config.Config) {
	config.StoreSnapshot(&s.cfg, cfg)
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
		mux.Handle("GET /", spa(s.WebDist, func() string { return s.Config().PublicPath }))
	}
	return auth.Middleware(s.Config, s.Sessions)(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "engine": s.Engine})
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request) {
	cfg := s.Config()
	var rgVersion any
	if s.Version != "" {
		rgVersion = s.Version
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"engine":         s.Engine,
		"rgVersion":      rgVersion,
		"rootLabel":      cfg.RootLabel,
		"root":           cfg.RootReal,
		"followSymlinks": cfg.FollowSymlinks,
		"limits": map[string]any{
			"maxResults":      cfg.MaxResults,
			"maxResultsHard":  cfg.MaxResultsHard,
			"timeoutMs":       cfg.TimeoutMs,
			"previewBytes":    cfg.PreviewBytes,
			"previewLines":    cfg.PreviewLines, // deprecated; not used for GET /api/file
			"previewChunk":    cfg.FilePreviewCount(),
			"previewChunkMax": cfg.FilePreviewCountMax(),
			"queryMaxChars":   config.QueryMaxChars,
		},
		"defaultLocale": "zh-CN",
		"authRequired":  cfg.TokenHash != "",
		"searchCount":   s.Search.Stats.Get(),
	})
}

func ListenAndServe(s *Server) error {
	cfg := s.Config()
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	hs := &http.Server{
		Addr:              addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return hs.ListenAndServe()
}
