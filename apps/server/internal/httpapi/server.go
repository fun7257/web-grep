package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
	"web-grep/internal/logx"
	"web-grep/internal/preview"
	"web-grep/internal/search"
	"web-grep/internal/tree"
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
		mux.Handle("GET /", spa(s.WebDist))
	}
	return auth.Middleware(s.Cfg, s.Sessions)(mux)
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

type searchBody struct {
	Query         string   `json:"query"`
	Path          *string  `json:"path"`
	GlobInclude   []string `json:"globInclude"`
	GlobExclude   []string `json:"globExclude"`
	Regex         *bool    `json:"regex"`
	CaseSensitive *bool    `json:"caseSensitive"`
	WordMatch     *bool    `json:"wordMatch"`
	Hidden        *bool    `json:"hidden"`
	MaxResults    *int     `json:"maxResults"`
	MtimeAfter    *int64   `json:"mtimeAfter"`
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	var body searchBody
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
		return
	}
	req, err := parseSearch(body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	pre := s.Search.Preflight(req)
	if !pre.OK {
		writeErr(w, pre.Status, pre.Code, pre.Message)
		return
	}
	defer s.Search.Release(pre.SearchID)
	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	_ = rc.Flush()

	sw := &sseWriter{w: w, rc: rc}
	s.Search.Run(r.Context(), pre, sw)
}

func parseSearch(b searchBody) (search.Request, error) {
	q := strings.TrimSpace(b.Query)
	if q == "" || len(q) > config.QueryMaxChars {
		return search.Request{}, errors.New("invalid query")
	}
	path := ""
	if b.Path != nil {
		path = *b.Path
	}
	if len(path) > config.PathMaxChars {
		return search.Request{}, errors.New("invalid query")
	}
	if len(b.GlobInclude) > config.GlobMaxCount || len(b.GlobExclude) > config.GlobMaxCount {
		return search.Request{}, errors.New("invalid query")
	}
	for _, g := range b.GlobInclude {
		if len(g) > config.GlobMaxChars {
			return search.Request{}, errors.New("invalid query")
		}
	}
	for _, g := range b.GlobExclude {
		if len(g) > config.GlobMaxChars {
			return search.Request{}, errors.New("invalid query")
		}
	}
	req := search.Request{
		Query:         q,
		Path:          path,
		GlobInclude:   b.GlobInclude,
		GlobExclude:   b.GlobExclude,
		Regex:         false,
		CaseSensitive: false,
		Hidden:        true,
	}
	if req.GlobInclude == nil {
		req.GlobInclude = []string{}
	}
	if req.GlobExclude == nil {
		req.GlobExclude = []string{}
	}
	if b.Regex != nil {
		req.Regex = *b.Regex
	}
	if b.CaseSensitive != nil {
		req.CaseSensitive = *b.CaseSensitive
	}
	if b.WordMatch != nil {
		req.WordMatch = *b.WordMatch
	}
	if b.Hidden != nil {
		req.Hidden = *b.Hidden
	}
	if b.MaxResults != nil {
		if *b.MaxResults < 1 {
			return search.Request{}, errors.New("invalid query")
		}
		if config.MaxResultsHard > 0 && *b.MaxResults > config.MaxResultsHard {
			return search.Request{}, errors.New("invalid query")
		}
		req.MaxResults = *b.MaxResults
	}
	if b.MtimeAfter != nil {
		if *b.MtimeAfter < 0 {
			return search.Request{}, errors.New("invalid query")
		}
		if *b.MtimeAfter > 0 {
			after := time.UnixMilli(*b.MtimeAfter)
			if after.After(time.Now().Add(time.Hour)) {
				after = time.Now()
			}
			req.MtimeAfter = after
		}
	}
	return req, nil
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	path := q.Get("path")
	if path == "" || len(path) > config.PathMaxChars {
		writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
		return
	}
	count := preview.DefaultCount
	if raw := q.Get("count"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
			return
		}
		count = n
	}
	tail := q.Get("tail") == "1" || q.Get("tail") == "true"
	from := 0
	if raw := q.Get("from"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
			return
		}
		from = n
	}
	if !tail && from < 1 {
		line := 1
		if raw := q.Get("line"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 {
				writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
				return
			}
			line = n
		}
		from = line - count/2
		if from < 1 {
			from = 1
		}
	}
	win, err := preview.ReadSlice(s.Cfg, preview.Query{Path: path, From: from, Count: count, Tail: tail})
	if err != nil {
		var pe *preview.Error
		if errors.As(err, &pe) {
			logx.Warn("sandbox reject", map[string]any{"code": pe.Code})
			writeErr(w, pe.Status, pe.Code, pe.Message)
			return
		}
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}
	writeJSON(w, http.StatusOK, win)
}

func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	if len(rel) > config.PathMaxChars {
		writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
		return
	}
	var after time.Time
	if raw := r.URL.Query().Get("mtimeAfter"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
			return
		}
		if n > 0 {
			after = time.UnixMilli(n)
			if after.After(time.Now().Add(time.Hour)) {
				after = time.Now()
			}
		}
	}
	listing, err := tree.List(s.Cfg.RootReal, rel, s.Cfg.AllowSecrets, after)
	if err != nil {
		logx.Warn("sandbox reject", map[string]any{"code": "INVALID_PATH"})
		writeErr(w, http.StatusNotFound, "INVALID_PATH", "invalid path")
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

func (s *Server) count(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	if len(rel) > config.PathMaxChars {
		writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
		return
	}
	var after time.Time
	if raw := r.URL.Query().Get("mtimeAfter"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
			return
		}
		if n > 0 {
			after = time.UnixMilli(n)
			if after.After(time.Now().Add(time.Hour)) {
				after = time.Now()
			}
		}
	}
	n, err := tree.CountFiles(s.Cfg.RootReal, rel, s.Cfg.AllowSecrets, after)
	if err != nil {
		logx.Warn("sandbox reject", map[string]any{"code": "INVALID_PATH"})
		writeErr(w, http.StatusNotFound, "INVALID_PATH", "invalid path")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": n})
}

type sseWriter struct {
	mu        sync.Mutex
	w         http.ResponseWriter
	rc        *http.ResponseController
	buf       []byte
	hits      int
	lastFlush time.Time
	aborted   bool
}

const (
	sseHitBatch   = 16
	sseFlushEvery = 10 * time.Millisecond
)

func (s *sseWriter) Event(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.aborted {
		return context.Canceled
	}
	s.buf = append(s.buf, "event: "...)
	s.buf = append(s.buf, name...)
	s.buf = append(s.buf, "\ndata: "...)
	s.buf = append(s.buf, b...)
	s.buf = append(s.buf, "\n\n"...)
	if s.lastFlush.IsZero() {
		s.lastFlush = time.Now()
	}
	if name == "hit" {
		s.hits++
		if s.hits < sseHitBatch && time.Since(s.lastFlush) < sseFlushEvery {
			return nil
		}
	}
	return s.flushLocked()
}

func (s *sseWriter) Ping() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.aborted {
		return
	}
	_ = s.flushLocked()
	_, _ = io.WriteString(s.w, ": ping\n\n")
	_ = s.rc.Flush()
}

func (s *sseWriter) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flushLocked()
}

func (s *sseWriter) flushLocked() error {
	if s.aborted {
		return context.Canceled
	}
	if len(s.buf) == 0 {
		s.lastFlush = time.Now()
		s.hits = 0
		return nil
	}
	if _, err := s.w.Write(s.buf); err != nil {
		s.aborted = true
		return err
	}
	s.buf = s.buf[:0]
	s.hits = 0
	s.lastFlush = time.Now()
	if err := s.rc.Flush(); err != nil {
		s.aborted = true
		return err
	}
	return nil
}

func (s *sseWriter) Aborted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.aborted
}

func spa(dir string) http.Handler {
	root := os.DirFS(dir)
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if name == "index.html" {
			w.Header().Set("Cache-Control", "no-store")
		} else if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if _, err := fs.Stat(root, name); err != nil {
			w.Header().Set("Cache-Control", "no-store")
			r = r.Clone(r.Context())
			r.URL.Path = "/"
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
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
