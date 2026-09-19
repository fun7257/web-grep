package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/rg"
	"web-grep/internal/search"
)

type searchBody struct {
	Query         string          `json:"query"`
	AndTerms      json.RawMessage `json:"andTerms"`
	Path          *string         `json:"path"`
	GlobInclude   []string        `json:"globInclude"`
	GlobAnd       []string        `json:"globAnd"`
	GlobExclude   []string        `json:"globExclude"`
	Regex         *bool           `json:"regex"`
	CaseSensitive *bool           `json:"caseSensitive"`
	WordMatch     *bool           `json:"wordMatch"`
	Hidden        *bool           `json:"hidden"`
	MaxResults    *int            `json:"maxResults"`
	MtimeAfter    *int64          `json:"mtimeAfter"`
}

type wireAndTerm struct {
	Query         string `json:"query"`
	Regex         *bool  `json:"regex"`
	CaseSensitive *bool  `json:"caseSensitive"`
	WordMatch     *bool  `json:"wordMatch"`
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

func parseAndTerms(raw json.RawMessage) ([]rg.AndTerm, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []rg.AndTerm{}, nil
	}
	var strs []string
	if err := json.Unmarshal(raw, &strs); err == nil {
		if len(strs) > 16 {
			return nil, errors.New("invalid query")
		}
		out := make([]rg.AndTerm, 0, len(strs))
		for _, term := range strs {
			term = strings.TrimSpace(term)
			if term == "" || len(term) > config.QueryMaxChars {
				return nil, errors.New("invalid query")
			}
			out = append(out, rg.AndTerm{Query: term})
		}
		return out, nil
	}
	var objs []wireAndTerm
	if err := json.Unmarshal(raw, &objs); err != nil {
		return nil, errors.New("invalid query")
	}
	if len(objs) > 16 {
		return nil, errors.New("invalid query")
	}
	out := make([]rg.AndTerm, 0, len(objs))
	for _, obj := range objs {
		query := strings.TrimSpace(obj.Query)
		if query == "" || len(query) > config.QueryMaxChars {
			return nil, errors.New("invalid query")
		}
		term := rg.AndTerm{Query: query}
		if obj.Regex != nil {
			term.Regex = *obj.Regex
		}
		if obj.CaseSensitive != nil {
			term.CaseSensitive = *obj.CaseSensitive
		}
		if obj.WordMatch != nil {
			term.WordMatch = *obj.WordMatch
		}
		out = append(out, term)
	}
	return out, nil
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
	andTerms, err := parseAndTerms(b.AndTerms)
	if err != nil {
		return search.Request{}, err
	}
	if len(b.GlobInclude) > config.GlobMaxCount || len(b.GlobAnd) > config.GlobMaxCount || len(b.GlobExclude) > config.GlobMaxCount {
		return search.Request{}, errors.New("invalid query")
	}
	for _, g := range b.GlobInclude {
		if len(g) > config.GlobMaxChars {
			return search.Request{}, errors.New("invalid query")
		}
	}
	for _, g := range b.GlobAnd {
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
		AndTerms:      andTerms,
		Path:          path,
		GlobInclude:   b.GlobInclude,
		GlobAnd:       b.GlobAnd,
		GlobExclude:   b.GlobExclude,
		Regex:         false,
		CaseSensitive: false,
		Hidden:        true,
	}
	if req.AndTerms == nil {
		req.AndTerms = []rg.AndTerm{}
	}
	if req.GlobInclude == nil {
		req.GlobInclude = []string{}
	}
	if req.GlobAnd == nil {
		req.GlobAnd = []string{}
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
		after, err := clampMtimeAfterMillis(*b.MtimeAfter)
		if err != nil {
			return search.Request{}, err
		}
		req.MtimeAfter = after
	}
	return req, nil
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
