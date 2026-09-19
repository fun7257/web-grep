package httpapi

import (
	"net"
	"net/http"
	"strings"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/ratelimit"
)

const readBusyMessage = "too many tree/file requests"

func (s *Server) acquireRead(w http.ResponseWriter, r *http.Request) (release func(), ok bool) {
	if s.Reads == nil {
		s.Reads = ratelimit.New()
	}
	cfg := s.Config()
	if s.Reads.Acquire(
		s.clientKey(r),
		time.Now(),
		cfg.EffectiveReadMaxConcurrent(),
		cfg.EffectiveReadRateLimit(),
		cfg.EffectiveReadRateWindow(),
	) {
		return s.Reads.Release, true
	}
	writeErr(w, http.StatusTooManyRequests, "BUSY", readBusyMessage)
	return nil, false
}

func (s *Server) clientKey(r *http.Request) string {
	if tok := auth.ExtractToken(r); tok != "" && s.Sessions != nil && s.Sessions.Lookup(tok) {
		return "s:" + tok
	}
	return "ip:" + peerIP(r)
}

func peerIP(r *http.Request) string {
	if r == nil {
		return "unknown"
	}
	addr := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	if addr == "" {
		return "unknown"
	}
	return addr
}
