package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	QueryMaxChars        = 8192
	PathMaxChars         = 4096
	GlobMaxChars         = 256
	GlobMaxCount         = 4096
	MaxResultsDefault    = 20_000
	MaxResultsHard       = 0
	TimeoutMsDefault     = 0
	MaxConcurrentDefault = 8
	PreviewBytes         = 0
	PreviewLines         = 201
	LineTextMaxChars     = 65_536
	HeartbeatMs          = 5_000
)

const (
	EnvRoot           = "WEB_GREP_ROOT"
	EnvHost           = "WEB_GREP_HOST"
	EnvPort           = "WEB_GREP_PORT"
	EnvPublicHost     = "WEB_GREP_PUBLIC_HOST"
	EnvToken          = "WEB_GREP_TOKEN"
	EnvRg             = "WEB_GREP_RG"
	EnvWebDist        = "WEB_GREP_WEB_DIST"
	EnvDev            = "WEB_GREP_DEV"
	EnvLogLevel       = "WEB_GREP_LOG_LEVEL"
	EnvMaxResults     = "WEB_GREP_MAX_RESULTS"
	EnvMaxResultsHard = "WEB_GREP_MAX_RESULTS_HARD"
	EnvTimeoutMs      = "WEB_GREP_TIMEOUT_MS"
	EnvPreviewLines   = "WEB_GREP_PREVIEW_LINES"
	EnvThreads        = "WEB_GREP_THREADS"
	EnvMaxConcurrent  = "WEB_GREP_MAX_CONCURRENT"
	EnvSearchZip      = "WEB_GREP_SEARCH_ZIP"
	EnvFollowSymlinks = "WEB_GREP_FOLLOW_SYMLINKS"
	EnvNoIgnore       = "WEB_GREP_NO_IGNORE"
	EnvAllowSecrets   = "WEB_GREP_ALLOW_SECRETS"
	EnvPublicPath     = "WEB_GREP_PUBLIC_PATH"
)

type Config struct {
	RootReal       string
	RootLabel      string
	Host           string
	Port           int
	PublicHosts    []string
	TokenHash      string
	ConfigPath     string
	sealToken      bool
	AllowSecrets   bool
	FollowSymlinks bool
	NoIgnore       bool
	MaxResults     int
	MaxResultsHard int
	TimeoutMs      int
	PreviewBytes   int
	PreviewLines   int
	Threads        int
	MaxConcurrent  int
	SearchZip      bool
	RgPath         string
	LogLevel       string
	Dev            bool
	WebDist        string
	PublicPath     string
}

func Load(explicit string) (Config, error) {
	path, err := findConfig(explicit)
	if err != nil {
		return Config{}, err
	}
	raw, err := readYAMLFile(path)
	if err != nil {
		return Config{}, err
	}
	tokenFromEnv := false
	if _, ok := lookupTrim(EnvToken); ok {
		tokenFromEnv = true
	}
	if err := applyEnv(&raw); err != nil {
		return Config{}, err
	}

	rootRaw := strings.TrimSpace(raw.Root)
	if rootRaw == "" {
		return Config{}, fmt.Errorf("root is required (config.yaml root, or %s)", EnvRoot)
	}
	rootReal, err := resolveRoot(rootRaw)
	if err != nil {
		return Config{}, err
	}
	host := strings.TrimSpace(raw.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := intOr(raw.Port, 8787)
	if port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("invalid port: %d", port)
	}
	maxHard := intOr(raw.MaxResultsHard, MaxResultsHard)
	if maxHard < 0 || maxHard > 1_000_000_000 {
		return Config{}, fmt.Errorf("invalid max_results_hard: %d", maxHard)
	}
	maxRes := intOr(raw.MaxResults, MaxResultsDefault)
	if maxRes < 0 || maxRes > 1_000_000_000 {
		return Config{}, fmt.Errorf("invalid max_results: %d", maxRes)
	}
	if maxHard > 0 && (maxRes <= 0 || maxRes > maxHard) {
		maxRes = maxHard
	}
	timeout := intOr(raw.TimeoutMs, TimeoutMsDefault)
	if timeout < 0 || timeout > 86_400_000 {
		return Config{}, fmt.Errorf("invalid timeout_ms: %d", timeout)
	}
	previewLines := intOr(raw.PreviewLines, PreviewLines)
	if previewLines < 1 || previewLines > 10_000 {
		return Config{}, fmt.Errorf("invalid preview_lines: %d", previewLines)
	}
	threads := intOr(raw.Threads, 0)
	if threads < 0 || threads > 1024 {
		return Config{}, fmt.Errorf("invalid threads: %d", threads)
	}
	maxConc := intOr(raw.MaxConcurrent, MaxConcurrentDefault)
	if maxConc < 1 || maxConc > 64 {
		return Config{}, fmt.Errorf("invalid max_concurrent: %d", maxConc)
	}
	level := strings.TrimSpace(raw.LogLevel)
	if level == "" {
		level = "info"
	}
	switch level {
	case "debug", "info", "warn", "error":
	default:
		return Config{}, fmt.Errorf("invalid log_level: %s", level)
	}
	rgPath := strings.TrimSpace(raw.Rg)
	if rgPath != "" && !filepath.IsAbs(rgPath) {
		return Config{}, fmt.Errorf("rg must be an absolute path")
	}
	publicPath, err := NormalizePublicPath(raw.PublicPath)
	if err != nil {
		return Config{}, err
	}
	tokenHash, wasPlain := parseToken(raw.Token)
	cfg := Config{
		RootReal:       rootReal,
		RootLabel:      filepath.Base(rootReal),
		Host:           host,
		Port:           port,
		PublicHosts:    append([]string(nil), raw.PublicHost...),
		TokenHash:      tokenHash,
		ConfigPath:     path,
		sealToken:      wasPlain && path != "" && !tokenFromEnv,
		AllowSecrets:   boolOr(raw.AllowSecrets, false),
		FollowSymlinks: boolOr(raw.FollowSymlinks, true),
		NoIgnore:       boolOr(raw.NoIgnore, true),
		MaxResults:     maxRes,
		MaxResultsHard: maxHard,
		TimeoutMs:      timeout,
		PreviewBytes:   0,
		PreviewLines:   previewLines,
		Threads:        threads,
		MaxConcurrent:  maxConc,
		SearchZip:      boolOr(raw.SearchZip, true),
		RgPath:         rgPath,
		LogLevel:       level,
		Dev:            boolOr(raw.Dev, false),
		WebDist:        strings.TrimSpace(raw.WebDist),
		PublicPath:     publicPath,
	}
	if err := AssertBindPolicy(cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func IsLoopbackBind(host string) bool {
	switch host {
	case "127.0.0.1", "::1", "localhost":
		return true
	default:
		return false
	}
}

func AssertBindPolicy(cfg Config) error {
	if IsLoopbackBind(cfg.Host) {
		return nil
	}
	if cfg.TokenHash == "" {
		return fmt.Errorf("refusing to bind %s without token (config.yaml token, or %s)", cfg.Host, EnvToken)
	}
	if len(cfg.PublicHosts) == 0 {
		return fmt.Errorf("0.0.0.0 is a bind address, not a Host. Set public_host to the name/IP in the address bar")
	}
	return nil
}

func NormalizePublicPath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" || p == "/" {
		return "", nil
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = strings.TrimRight(p, "/")
	if p == "" {
		return "", nil
	}
	if strings.Contains(p, "..") || strings.Contains(p, "//") || strings.ContainsAny(p, "?#") {
		return "", fmt.Errorf("invalid public_path %q", raw)
	}
	first, _, _ := strings.Cut(strings.TrimPrefix(p, "/"), "/")
	if strings.EqualFold(first, "api") {
		return "", fmt.Errorf("public_path must not start with /api")
	}
	return p, nil
}

func StripPublicPath(prefix, path string) string {
	if prefix == "" {
		return path
	}
	if path == prefix {
		return "/"
	}
	if strings.HasPrefix(path, prefix+"/") {
		out := path[len(prefix):]
		if out == "" {
			return "/"
		}
		return out
	}
	return path
}

func NormalizeHostname(host string) string {
	trimmed := strings.ToLower(strings.TrimSpace(host))
	if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
		return trimmed[1 : len(trimmed)-1]
	}
	return trimmed
}

func ParsePublicHosts(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var hosts []string
	for _, part := range strings.Split(raw, ",") {
		host := NormalizeHostname(part)
		if host == "" {
			continue
		}
		if host == "0.0.0.0" || host == "::" || host == "[::]" {
			return nil, fmt.Errorf("public_host must not include 0.0.0.0 (bind address, not a Host)")
		}
		hosts = append(hosts, host)
	}
	return hosts, nil
}

func resolveRoot(raw string) (string, error) {
	expanded := expandHome(raw)
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return "", fmt.Errorf("root is not a readable directory: %s", raw)
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("root is not a readable directory: %s", raw)
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("root is not a readable directory: %s", raw)
	}
	return real, nil
}

func expandHome(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return trimmed
		}
		return home
	}
	if strings.HasPrefix(trimmed, "~/") || strings.HasPrefix(trimmed, `~\`) {
		home, err := os.UserHomeDir()
		if err != nil {
			return trimmed
		}
		return home + trimmed[1:]
	}
	return trimmed
}
