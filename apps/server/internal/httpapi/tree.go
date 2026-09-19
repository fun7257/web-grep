package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"web-grep/internal/config"
	"web-grep/internal/logx"
	"web-grep/internal/tree"
)

var errInvalidListingQuery = errors.New("invalid request")

func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	release, ok := s.acquireRead(w, r)
	if !ok {
		return
	}
	defer release()
	rel, filter, err := parseListingQuery(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
		return
	}
	cfg := s.Config()
	listing, err := tree.List(cfg.RootReal, rel, cfg.AllowSecrets, filter)
	if err != nil {
		logx.Warn("sandbox reject", map[string]any{"code": "INVALID_PATH"})
		writeErr(w, http.StatusNotFound, "INVALID_PATH", "invalid path")
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

func parseListingQuery(r *http.Request) (string, tree.Filter, error) {
	rel := r.URL.Query().Get("path")
	if len(rel) > config.PathMaxChars {
		return "", tree.Filter{}, errInvalidListingQuery
	}
	after, err := parseQueryMtimeAfter(r)
	if err != nil {
		return "", tree.Filter{}, err
	}
	return rel, tree.Filter{
		After:   after,
		Include: queryGlobs(r, "include"),
		Exclude: queryGlobs(r, "exclude"),
	}, nil
}

func parseQueryMtimeAfter(r *http.Request) (time.Time, error) {
	raw := r.URL.Query().Get("mtimeAfter")
	if raw == "" {
		return time.Time{}, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Time{}, errInvalidListingQuery
	}
	after, err := clampMtimeAfterMillis(n)
	if err != nil {
		return time.Time{}, errInvalidListingQuery
	}
	return after, nil
}

func clampMtimeAfterMillis(n int64) (time.Time, error) {
	if n < 0 {
		return time.Time{}, errors.New("invalid query")
	}
	if n == 0 {
		return time.Time{}, nil
	}
	after := time.UnixMilli(n)
	if after.After(time.Now().Add(time.Hour)) {
		after = time.Now()
	}
	return after, nil
}

func queryGlobs(r *http.Request, key string) []string {
	var out []string
	for _, raw := range r.URL.Query()[key] {
		cleaned := strings.NewReplacer(",", " ", ";", " ").Replace(raw)
		out = append(out, strings.Fields(cleaned)...)
	}
	if len(out) > config.GlobMaxCount {
		out = out[:config.GlobMaxCount]
	}
	return out
}
