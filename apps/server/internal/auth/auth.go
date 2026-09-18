package auth

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"web-grep/internal/config"
	"web-grep/internal/logx"
)

var alwaysHosts = map[string]struct{}{
	"127.0.0.1": {},
	"localhost": {},
	"::1":       {},
}

var publicPaths = map[string]struct{}{
	"/api/health":      {},
	"/api/auth/status": {},
	"/api/auth/login":  {},
	"/api/auth/logout": {},
}

func AllowedHostnames(cfg config.Config) map[string]struct{} {
	hosts := make(map[string]struct{}, len(alwaysHosts)+len(cfg.PublicHosts))
	for h := range alwaysHosts {
		hosts[h] = struct{}{}
	}
	for _, h := range cfg.PublicHosts {
		n := config.NormalizeHostname(h)
		if n == "0.0.0.0" || n == "::" {
			continue
		}
		hosts[n] = struct{}{}
	}
	return hosts
}

func SplitHostPort(host string) (hostname string, port string) {
	trimmed := strings.TrimSpace(host)
	if strings.HasPrefix(trimmed, "[") {
		end := strings.IndexByte(trimmed, ']')
		if end == -1 {
			return config.NormalizeHostname(trimmed), ""
		}
		hostname = config.NormalizeHostname(trimmed[:end+1])
		rest := trimmed[end+1:]
		if strings.HasPrefix(rest, ":") && len(rest) > 1 {
			return hostname, rest[1:]
		}
		return hostname, ""
	}
	last := strings.LastIndexByte(trimmed, ':')
	if last == -1 {
		return config.NormalizeHostname(trimmed), ""
	}
	portPart := trimmed[last+1:]
	if strings.IndexByte(trimmed, ':') == last && portPart != "" && isDigits(portPart) {
		return config.NormalizeHostname(trimmed[:last]), portPart
	}
	return config.NormalizeHostname(trimmed), ""
}

func isDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func hostnameAllowed(hostname string, hosts map[string]struct{}) bool {
	if hostname == "0.0.0.0" || hostname == "::" {
		return false
	}
	_, ok := hosts[hostname]
	return ok
}

func AllowedHostHeader(hostHeader string, hosts map[string]struct{}) bool {
	hostname, _ := SplitHostPort(hostHeader)
	return hostnameAllowed(hostname, hosts)
}

func AllowedOrigin(origin string, hosts map[string]struct{}) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return hostnameAllowed(config.NormalizeHostname(u.Hostname()), hosts)
}

func ExtractToken(r *http.Request) string {
	if t := strings.TrimSpace(r.Header.Get("X-Web-Grep-Token")); t != "" {
		return t
	}
	authz := r.Header.Get("Authorization")
	if authz == "" {
		return ""
	}
	const p = "Bearer "
	if len(authz) < len(p) || !strings.EqualFold(authz[:len(p)], p) {
		return ""
	}
	return strings.TrimSpace(authz[len(p):])
}

func isPublicPath(path string) bool {
	if _, ok := publicPaths[path]; ok {
		return true
	}
	// SPA HTML/JS/CSS are same-origin as /api. They must load before login.
	return path != "/api" && !strings.HasPrefix(path, "/api/")
}

func Middleware(cfgFn func() config.Config, sessions *Sessions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cfg := cfgFn()
			hosts := AllowedHostnames(cfg)
			host := r.Host
			if host == "" {
				host = r.Header.Get("Host")
			}
			if host == "" || !AllowedHostHeader(host, hosts) {
				logx.Warn("bad Host", map[string]any{"code": "FORBIDDEN_HOST", "host": host})
				writeJSON(w, http.StatusForbidden, map[string]string{"code": "FORBIDDEN_HOST", "message": "Host not allowed"})
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				if !AllowedOrigin(origin, hosts) {
					logx.Warn("bad Origin", map[string]any{"code": "FORBIDDEN_HOST"})
					writeJSON(w, http.StatusForbidden, map[string]string{"code": "FORBIDDEN_HOST", "message": "Host not allowed"})
					return
				}
			}
			stripped := config.StripPublicPath(cfg.PublicPath, r.URL.Path)
			if stripped != r.URL.Path {
				r = r.Clone(r.Context())
				r.URL.Path = stripped
			}
			if isPublicPath(r.URL.Path) || cfg.TokenHash == "" {
				next.ServeHTTP(w, r)
				return
			}
			provided := ExtractToken(r)
			if sessions == nil || !sessions.Lookup(provided) {
				logx.Warn("auth fail", map[string]any{"code": "UNAUTHORIZED"})
				writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "UNAUTHORIZED", "message": "missing or invalid session"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v map[string]string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
