package search

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/logx"
	"web-grep/internal/rg"
	"web-grep/internal/sandbox"
	"web-grep/internal/stats"
)

type Request struct {
	Query         string
	FilterTerms   []rg.FilterTerm
	Path          string
	GlobInclude   []string
	GlobIntersect []string
	GlobExclude   []string
	Regex         bool
	CaseSensitive bool
	WordMatch     bool
	Hidden        bool
	MaxResults    int
	MtimeAfter    time.Time
}

type Preflight struct {
	OK            bool
	Status        int
	Code          string
	Message       string
	SearchID      string
	Request       Request
	RelativeDir   string
	GlobInclude   []string
	GlobIntersect []string
	GlobExclude   []string
	MaxResults    int
}

type Engine interface {
	Kind() string
	Search(ctx context.Context, in rg.Input, emit func(rg.Match) error, progress func(files int)) error
}

type Service struct {
	cfg    atomic.Pointer[config.Config]
	Engine Engine
	Kind   string // "rg" | "none"
	Stats  *stats.Counter

	mu       sync.Mutex
	inflight map[string]context.CancelFunc
}

func New(cfg config.Config, engine Engine, kind string, counter *stats.Counter) *Service {
	s := &Service{
		Engine:   engine,
		Kind:     kind,
		Stats:    counter,
		inflight: make(map[string]context.CancelFunc),
	}
	s.SetCfg(cfg)
	return s
}

// Snapshot returns the current config copy. Concurrent SetCfg swaps are
// atomic: readers never observe a half-updated value.
func (s *Service) Snapshot() config.Config {
	return config.LoadSnapshot(&s.cfg)
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

func (s *Service) Preflight(req Request) Preflight {
	cfg := s.Snapshot()
	if s.Kind == "none" || s.Engine == nil {
		return Preflight{Status: 503, Code: "ENGINE", Message: "ripgrep is not available"}
	}
	resolved, err := sandbox.ResolveUnderRoot(cfg.RootReal, req.Path)
	if err != nil {
		logx.Warn("sandbox reject", map[string]any{"code": "INVALID_PATH"})
		return Preflight{Status: 400, Code: "INVALID_PATH", Message: "invalid path"}
	}
	if resolved.Rel != "" && sandbox.IsDenied(resolved.Rel, cfg.AllowSecrets) {
		return Preflight{Status: 403, Code: "DENIED", Message: "path is denied"}
	}
	var include, exclude []string
	for _, g := range req.GlobInclude {
		clean, err := sandbox.SanitizeUserGlob(g)
		if err != nil {
			return Preflight{Status: 400, Code: "INVALID_GLOB", Message: "invalid glob"}
		}
		posix := sandbox.ToPosixRel(clean)
		if sandbox.IsDenied(posix, cfg.AllowSecrets) {
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
	var and []string
	for _, g := range req.GlobIntersect {
		clean, err := sandbox.SanitizeUserGlob(g)
		if err != nil {
			return Preflight{Status: 400, Code: "INVALID_GLOB", Message: "invalid glob"}
		}
		posix := sandbox.ToPosixRel(clean)
		if sandbox.IsDenied(posix, cfg.AllowSecrets) {
			continue
		}
		and = append(and, clean)
	}
	id := newUUID()
	if !s.acquireSlot(id) {
		return Preflight{Status: 429, Code: "BUSY", Message: "too many concurrent searches"}
	}
	rel := resolved.Rel
	if rel == "" {
		rel = "."
	}
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = cfg.MaxResults
	}
	if cfg.MaxResultsHard > 0 && (maxResults <= 0 || maxResults > cfg.MaxResultsHard) {
		maxResults = cfg.MaxResultsHard
	}
	return Preflight{
		OK:            true,
		SearchID:      id,
		Request:       req,
		RelativeDir:   rel,
		GlobInclude:   include,
		GlobIntersect: and,
		GlobExclude:   exclude,
		MaxResults:    maxResults,
	}
}

func (s *Service) maxConcurrentLocked() int {
	maxC := s.Snapshot().MaxConcurrent
	if maxC <= 0 {
		return config.MaxConcurrentDefault
	}
	return maxC
}

func (s *Service) acquireSlot(id string) bool {
	if id == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.inflight) >= s.maxConcurrentLocked() {
		return false
	}
	s.inflight[id] = nopCancel
	return true
}

func (s *Service) bindCancel(id string, cancel context.CancelFunc) {
	if id == "" || cancel == nil {
		return
	}
	s.mu.Lock()
	if _, ok := s.inflight[id]; ok {
		s.inflight[id] = cancel
	}
	s.mu.Unlock()
}

func nopCancel() {}

func (s *Service) SetCfg(cfg config.Config) {
	config.StoreSnapshot(&s.cfg, cfg)
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
	// Slot is acquired in Preflight. Release on every exit path (success,
	// cancel, timeout, error, and the early returns below). HTTP also
	// defers Release; delete is idempotent.
	if pre.SearchID != "" {
		defer s.Release(pre.SearchID)
	}
	cfg := s.Snapshot()
	var ctx context.Context
	var cancel context.CancelFunc
	if cfg.TimeoutMs > 0 {
		ctx, cancel = context.WithTimeout(parent, time.Duration(cfg.TimeoutMs)*time.Millisecond)
	} else {
		ctx, cancel = context.WithCancel(parent)
	}
	defer cancel()
	s.bindCancel(pre.SearchID, cancel)

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
	if len(pre.Request.GlobIntersect) > 0 && len(pre.GlobIntersect) == 0 {
		sendDone(false, false, false, 0, 0)
		return
	}

	in := rg.Input{
		RootReal:       cfg.RootReal,
		RelativeDir:    pre.RelativeDir,
		Query:          pre.Request.Query,
		Regex:          pre.Request.Regex,
		CaseSensitive:  pre.Request.CaseSensitive,
		WordMatch:      pre.Request.WordMatch,
		Hidden:         pre.Request.Hidden,
		AllowSecrets:   cfg.AllowSecrets,
		FollowSymlinks: cfg.FollowSymlinks,
		NoIgnore:       cfg.NoIgnore,
		SearchZip:      cfg.SearchZip,
		Threads:        cfg.Threads,
		FilterTerms:    pre.Request.FilterTerms,
	}
	// mtimeAfter is the only reason to WalkDir + LimitToList. Otherwise
	// let rg recurse from the search root (or RelativeDir) with globs.
	if NeedsMtimeFileList(pre.Request.MtimeAfter) {
		listed, listErr := listNewerFiles(
			ctx,
			cfg.RootReal,
			pre.RelativeDir,
			pre.Request.MtimeAfter,
			pre.Request.Hidden,
			cfg.FollowSymlinks,
			cfg.AllowSecrets,
			pre.GlobExclude,
		)
		if listErr != nil {
			if ctx.Err() == nil {
				logEngineFailure("file list failed", pre.SearchID, "", listErr.Error(), cfg)
				sendError(listErr.Error())
				return
			}
		} else {
			listed = sandbox.FilterByGlobs(listed, pre.GlobInclude, nil)
			if len(pre.GlobIntersect) > 0 {
				listed = sandbox.FilterByGlobs(listed, pre.GlobIntersect, nil)
			}
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
	} else {
		in.GlobInclude = pre.GlobInclude
		in.GlobIntersect = pre.GlobIntersect
		in.GlobExclude = pre.GlobExclude
	}

	matchCount := 0
	files := map[string]struct{}{}
	truncated := false
	searchCtx, stopSearch := context.WithCancel(ctx)
	defer stopSearch()

	// Include/exclude (and globIntersect when include is empty) are already in
	// rg argv. rg ORs positive --glob flags, so include∩and cannot be
	// expressed there and is applied in Go — compiled once, not per hit.
	acceptHit := func(string) bool { return true }
	if !in.LimitToList && NeedGlobIntersectPostFilter(pre.GlobInclude, pre.GlobIntersect) {
		acceptHit = sandbox.CompileHitFilter(nil, nil, pre.GlobIntersect)
	}

	// rg follows symlinks when follow_symlinks is on, and RelUnderRoot only
	// checks how a path is spelled. Resolve each hit's real path so a link
	// that leads outside the root cannot surface files from outside it.
	// Several root-relative spellings can name one real file; keep the first.
	guard := sandbox.NewRealPathGuard(cfg.RootReal)
	outsideRoot := 0
	dupes := 0
	seenLine := map[string]struct{}{}

	lastProg := time.Now()
	var err error
	if ctx.Err() == nil {
		err = s.Engine.Search(searchCtx, in, func(m rg.Match) error {
			if truncated || searchCtx.Err() != nil || stream.Aborted() {
				return errStop
			}
			hit, ok := rg.ToRelativeHit(cfg.RootReal, cfg.AllowSecrets, m)
			if !ok {
				return nil
			}
			if !acceptHit(hit.Path) {
				return nil
			}
			canon, ok := guard.Canonical(hit.Path)
			if !ok {
				outsideRoot++
				return nil
			}
			// Same real file and line. The key is the canonical path, so a
			// symlink and its target collapse; the first spelling wins.
			key := canon + "\x00" + strconv.Itoa(hit.Line)
			if _, dup := seenLine[key]; dup {
				dupes++
				return nil
			}
			seenLine[key] = struct{}{}
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
	}
	_ = stream.Flush()
	if outsideRoot > 0 {
		logx.Warn("dropped hits outside root", map[string]any{"searchId": pre.SearchID, "count": outsideRoot})
	}
	if dupes > 0 {
		logx.Warn("dropped duplicate hits", map[string]any{"searchId": pre.SearchID, "count": dupes})
	}

	// AbortAll cancels this ctx (the one bindCancel registered), not the
	// request parent. A client disconnect cancels parent and therefore this
	// ctx as well. Timeout is the deadline error on the same ctx; hitting
	// maxResults only stops the search child, so it is not a cancel.
	timedOut := errors.Is(ctx.Err(), context.DeadlineExceeded)
	cancelled := !timedOut && ctx.Err() != nil

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
		full := err.Error()
		logEngineFailure("search failed", pre.SearchID, "ENGINE", full, cfg)
		sendError(full)
		return
	}
	sendDone(false, false, false, matchCount, len(files))
	logx.Info("search done", map[string]any{"searchId": pre.SearchID, "elapsedMs": time.Since(started).Milliseconds(), "matchCount": matchCount})
}

// logEngineFailure records a one-line summary at error and the full text at
// debug. rg repeats the pattern after the first stderr line; that echo must
// not land in warn or error. full is what the client still receives.
func logEngineFailure(msg, searchID, code, full string, cfg config.Config) {
	label := cfg.RootLabel
	if label == "" {
		label = filepath.Base(cfg.RootReal)
	}
	head, lines := logx.ClipForLog(full, cfg.RootReal, label)
	fields := map[string]any{
		"searchId": searchID,
		"err":      head,
		"lines":    lines,
	}
	if code != "" {
		fields["code"] = code
	}
	logx.Error(msg, fields)
	logx.Debug(msg, map[string]any{"searchId": searchID, "err": full})
}

var errStop = errors.New("stop")

// listNewerFiles is the WalkDir listing used when mtimeAfter is set.
// Tests replace this to assert the no-mtime path skips the walk.
var listNewerFiles = ListNewerFiles

// NeedsMtimeFileList is true when the request must list files by mtime
// before invoking rg. Zero / omitted mtimeAfter skips WalkDir.
func NeedsMtimeFileList(after time.Time) bool {
	return !after.IsZero()
}

// NeedGlobIntersectPostFilter is true when include and and are both set.
// Those two sets are intersected; rg --glob cannot express that intersection.
func NeedGlobIntersectPostFilter(include, and []string) bool {
	return len(include) > 0 && len(and) > 0
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	hexed := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexed[0:8], hexed[8:12], hexed[12:16], hexed[16:20], hexed[20:32])
}
