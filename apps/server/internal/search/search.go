package search

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/logx"
	"web-grep/internal/rg"
	"web-grep/internal/sandbox"
	"web-grep/internal/stats"
)

type Request struct {
	Query         string
	Path          string
	GlobInclude   []string
	GlobExclude   []string
	Regex         bool
	CaseSensitive bool
	WordMatch     bool
	Hidden        bool
	MaxResults    int
	MtimeAfter    time.Time
}

type Preflight struct {
	OK          bool
	Status      int
	Code        string
	Message     string
	SearchID    string
	Request     Request
	RelativeDir string
	GlobInclude []string
	GlobExclude []string
	MaxResults  int
}

type Engine interface {
	Kind() string
	Search(ctx context.Context, in rg.Input, emit func(rg.Match) error, progress func(files int)) error
}

type Service struct {
	Cfg    config.Config
	Engine Engine
	Kind   string // "rg" | "none"
	Stats  *stats.Counter

	mu       sync.Mutex
	inflight map[string]context.CancelFunc
}

func New(cfg config.Config, engine Engine, kind string, counter *stats.Counter) *Service {
	return &Service{
		Cfg:      cfg,
		Engine:   engine,
		Kind:     kind,
		Stats:    counter,
		inflight: make(map[string]context.CancelFunc),
	}
}

func (s *Service) Inflight() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.inflight)
}

func (s *Service) AbortAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.inflight {
		c()
	}
}

func (s *Service) Cancel(id string) {
	s.mu.Lock()
	c, ok := s.inflight[id]
	s.mu.Unlock()
	if ok {
		c()
	}
}

func (s *Service) Preflight(req Request) Preflight {
	if s.Kind == "none" || s.Engine == nil {
		return Preflight{Status: 503, Code: "ENGINE", Message: "ripgrep is not available"}
	}
	resolved, err := sandbox.ResolveUnderRoot(s.Cfg.RootReal, req.Path)
	if err != nil {
		logx.Warn("sandbox reject", map[string]any{"code": "INVALID_PATH"})
		return Preflight{Status: 400, Code: "INVALID_PATH", Message: "invalid path"}
	}
	if resolved.Rel != "" && sandbox.IsDenied(resolved.Rel, s.Cfg.AllowSecrets) {
		return Preflight{Status: 403, Code: "DENIED", Message: "path is denied"}
	}
	var include, exclude []string
	for _, g := range req.GlobInclude {
		clean, err := sandbox.SanitizeUserGlob(g)
		if err != nil {
			return Preflight{Status: 400, Code: "INVALID_GLOB", Message: "invalid glob"}
		}
		posix := sandbox.ToPosixRel(clean)
		if sandbox.IsDenied(posix, s.Cfg.AllowSecrets) {
			continue
		}
		include = append(include, clean)
	}
	for _, g := range req.GlobExclude {
		clean, err := sandbox.SanitizeUserGlob(g)
		if err != nil {
			return Preflight{Status: 400, Code: "INVALID_GLOB", Message: "invalid glob"}
		}
		exclude = append(exclude, clean)
	}
	id := newUUID()
	maxC := s.Cfg.MaxConcurrent
	if maxC <= 0 {
		maxC = config.MaxConcurrentDefault
	}
	s.mu.Lock()
	if len(s.inflight) >= maxC {
		s.mu.Unlock()
		return Preflight{Status: 429, Code: "BUSY", Message: "too many concurrent searches"}
	}
	s.inflight[id] = func() {}
	s.mu.Unlock()
	rel := resolved.Rel
	if rel == "" {
		rel = "."
	}
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = s.Cfg.MaxResults
	}
	if s.Cfg.MaxResultsHard > 0 && (maxResults <= 0 || maxResults > s.Cfg.MaxResultsHard) {
		maxResults = s.Cfg.MaxResultsHard
	}
	return Preflight{
		OK:          true,
		SearchID:    id,
		Request:     req,
		RelativeDir: rel,
		GlobInclude: include,
		GlobExclude: exclude,
		MaxResults:  maxResults,
	}
}

func (s *Service) SetCfg(cfg config.Config) {
	s.mu.Lock()
	s.Cfg = cfg
	s.mu.Unlock()
}

func (s *Service) Release(id string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	delete(s.inflight, id)
	s.mu.Unlock()
}

type Stream interface {
	Event(name string, data any) error
	Ping()
	Flush() error
	Aborted() bool
}

func (s *Service) Run(parent context.Context, pre Preflight, stream Stream) {
	var ctx context.Context
	var cancel context.CancelFunc
	if s.Cfg.TimeoutMs > 0 {
		ctx, cancel = context.WithTimeout(parent, time.Duration(s.Cfg.TimeoutMs)*time.Millisecond)
	} else {
		ctx, cancel = context.WithCancel(parent)
	}
	s.mu.Lock()
	s.inflight[pre.SearchID] = cancel
	s.mu.Unlock()
	defer func() {
		cancel()
		s.Release(pre.SearchID)
	}()

	started := time.Now()
	terminal := false
	sendDone := func(truncated, timedOut, cancelled bool, matchCount, fileCount int) {
		if terminal || stream.Aborted() {
			return
		}
		terminal = true
		_ = stream.Event("done", map[string]any{
			"elapsedMs":  time.Since(started).Milliseconds(),
			"matchCount": matchCount,
			"fileCount":  fileCount,
			"truncated":  truncated,
			"timedOut":   timedOut,
			"cancelled":  cancelled,
		})
	}
	sendError := func(msg string) {
		if terminal || stream.Aborted() {
			return
		}
		if msg == "" {
			msg = "ripgrep failed"
		}
		terminal = true
		_ = stream.Event("error", map[string]any{"code": "ENGINE", "message": msg})
	}

	stopPing := make(chan struct{})
	go func() {
		t := time.NewTicker(time.Duration(config.HeartbeatMs) * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-stopPing:
				return
			case <-t.C:
				stream.Ping()
			}
		}
	}()
	defer close(stopPing)

	q := pre.Request.Query
	if len(q) > 80 {
		q = q[:80]
	}
	logx.Debug("search start", map[string]any{"searchId": pre.SearchID, "query": q})

	searchCount := s.Stats.Add()
	if err := stream.Event("meta", map[string]any{
		"searchId":    pre.SearchID,
		"engine":      "rg",
		"searchCount": searchCount,
	}); err != nil {
		return
	}

	if len(pre.Request.GlobInclude) > 0 && len(pre.GlobInclude) == 0 {
		sendDone(false, false, false, 0, 0)
		return
	}

	in := rg.Input{
		RootReal:       s.Cfg.RootReal,
		RelativeDir:    pre.RelativeDir,
		Query:          pre.Request.Query,
		Regex:          pre.Request.Regex,
		CaseSensitive:  pre.Request.CaseSensitive,
		WordMatch:      pre.Request.WordMatch,
		Hidden:         pre.Request.Hidden,
		GlobInclude:    pre.GlobInclude,
		GlobExclude:    pre.GlobExclude,
		AllowSecrets:   s.Cfg.AllowSecrets,
		FollowSymlinks: s.Cfg.FollowSymlinks,
		NoIgnore:       s.Cfg.NoIgnore,
		SearchZip:      s.Cfg.SearchZip,
		Threads:        s.Cfg.Threads,
	}
	needList := !pre.Request.MtimeAfter.IsZero() ||
		len(pre.GlobInclude) > 0 ||
		len(pre.GlobExclude) > 0
	if needList {
		listed, listErr := ListNewerFiles(
			s.Cfg.RootReal,
			pre.RelativeDir,
			pre.Request.MtimeAfter,
			pre.Request.Hidden,
			s.Cfg.FollowSymlinks,
			s.Cfg.AllowSecrets,
		)
		if listErr != nil {
			logx.Error("mtime walk failed", map[string]any{"searchId": pre.SearchID, "err": listErr.Error()})
			sendError(listErr.Error())
			return
		}
		if len(listed) == 0 {
			sendDone(false, false, false, 0, 0)
			return
		}
		// rg ignores --glob on explicit paths; tree picks must be applied here.
		listed = sandbox.FilterByGlobs(listed, pre.GlobInclude, pre.GlobExclude)
		if len(listed) == 0 {
			sendDone(false, false, false, 0, 0)
			return
		}
		in.LimitToList = true
		in.FileList = listed
		_ = stream.Event("progress", map[string]any{
			"files":   len(listed),
			"matches": 0,
		})
	}

	matchCount := 0
	files := map[string]struct{}{}
	truncated := false
	searchCtx, stopSearch := context.WithCancel(ctx)
	defer stopSearch()

	lastProg := time.Now()
	err := s.Engine.Search(searchCtx, in, func(m rg.Match) error {
		if truncated || searchCtx.Err() != nil || stream.Aborted() {
			return errStop
		}
		hit, ok := rg.ToRelativeHit(s.Cfg.RootReal, s.Cfg.AllowSecrets, m)
		if !ok {
			return nil
		}
		if err := stream.Event("hit", hit); err != nil {
			return err
		}
		matchCount++
		files[hit.Path] = struct{}{}
		if pre.MaxResults > 0 && matchCount >= pre.MaxResults {
			truncated = true
			stopSearch()
			return errStop
		}
		return nil
	}, func(files int) {
		if time.Since(lastProg) < 200*time.Millisecond {
			return
		}
		lastProg = time.Now()
		_ = stream.Event("progress", map[string]any{"files": files, "matches": matchCount})
	})
	_ = stream.Flush()

	timedOut := errors.Is(ctx.Err(), context.DeadlineExceeded)
	cancelled := parent.Err() != nil && !timedOut

	if truncated {
		sendDone(true, false, false, matchCount, len(files))
		logx.Info("search done", map[string]any{"searchId": pre.SearchID, "elapsedMs": time.Since(started).Milliseconds(), "matchCount": matchCount})
		return
	}
	if timedOut {
		logx.Warn("search timeout", map[string]any{"searchId": pre.SearchID})
		sendDone(false, true, false, matchCount, len(files))
		return
	}
	if cancelled {
		logx.Warn("search abort", map[string]any{"searchId": pre.SearchID})
		sendDone(false, false, true, matchCount, len(files))
		return
	}
	if err != nil && !errors.Is(err, errStop) && !errors.Is(err, context.Canceled) {
		logx.Error("search failed", map[string]any{"searchId": pre.SearchID, "code": "ENGINE", "err": err.Error()})
		sendError(err.Error())
		return
	}
	sendDone(false, false, false, matchCount, len(files))
	logx.Info("search done", map[string]any{"searchId": pre.SearchID, "elapsedMs": time.Since(started).Milliseconds(), "matchCount": matchCount})
}

var errStop = errors.New("stop")

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	hexed := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexed[0:8], hexed[8:12], hexed[12:16], hexed[16:20], hexed[20:32])
}
