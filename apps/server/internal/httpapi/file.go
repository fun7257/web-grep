package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"web-grep/internal/config"
	"web-grep/internal/logx"
	"web-grep/internal/preview"
)

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
	win, err := preview.ReadSlice(s.Config(), preview.Query{Path: path, From: from, Count: count, Tail: tail})
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
