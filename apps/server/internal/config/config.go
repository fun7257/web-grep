package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
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
	BeforeAfterDefault   = 20
	BeforeAfterMax       = 100
	LineTextMaxChars     = 65_536
	HeartbeatMs          = 5_000
)

type Config struct {
	RootReal       string
	RootLabel      string
	Host           string
	Port           int
	PublicHosts    []string
	Token          string
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
}

func Load() (Config, error) {
	loadDotEnv()
	rootRaw := strings.TrimSpace(os.Getenv("WEB_GREP_ROOT"))
	if rootRaw == "" {
		return Config{}, fmt.Errorf("WEB_GREP_ROOT is required")
	}
	rootReal, err := resolveRoot(rootRaw)
	if err != nil {
		return Config{}, err
	}
	host := optional("WEB_GREP_HOST", "127.0.0.1")
	maxHard, err := parseInt("WEB_GREP_MAX_RESULTS_HARD", MaxResultsHard, 0, 1_000_000_000)
	if err != nil {
		return Config{}, err
	}
	maxRes, err := parseInt("WEB_GREP_MAX_RESULTS", MaxResultsDefault, 0, 1_000_000_000)
	if err != nil {
		return Config{}, err
	}
	if maxHard > 0 && (maxRes <= 0 || maxRes > maxHard) {
		maxRes = maxHard
	}
	port, err := parseInt("WEB_GREP_PORT", 8787, 1, 65535)
	if err != nil {
		return Config{}, err
	}
	timeout, err := parseInt("WEB_GREP_TIMEOUT_MS", TimeoutMsDefault, 0, 86_400_000)
	if err != nil {
		return Config{}, err
	}
	previewBytes := 0
	previewLines, err := parseInt("WEB_GREP_PREVIEW_LINES", PreviewLines, 1, 10_000)
	if err != nil {
		return Config{}, err
	}
	threads, err := parseInt("WEB_GREP_THREADS", 0, 0, 1024)
	if err != nil {
		return Config{}, err
	}
	allowSecrets, err := parseBool("WEB_GREP_ALLOW_SECRETS", false)
	if err != nil {
		return Config{}, err
	}
	follow, err := parseBool("WEB_GREP_FOLLOW_SYMLINKS", true)
	if err != nil {
		return Config{}, err
	}
	noIgnore, err := parseBool("WEB_GREP_NO_IGNORE", true)
	if err != nil {
		return Config{}, err
	}
	searchZip, err := parseBool("WEB_GREP_SEARCH_ZIP", true)
	if err != nil {
		return Config{}, err
	}
	maxConc, err := parseInt("WEB_GREP_MAX_CONCURRENT", MaxConcurrentDefault, 1, 64)
	if err != nil {
		return Config{}, err
	}
	public, err := ParsePublicHosts(os.Getenv("WEB_GREP_PUBLIC_HOST"))
	if err != nil {
		return Config{}, err
	}
	rgPath := strings.TrimSpace(os.Getenv("WEB_GREP_RG"))
	if rgPath != "" && !filepath.IsAbs(rgPath) {
		return Config{}, fmt.Errorf("WEB_GREP_RG must be an absolute path")
	}
	level := optional("WEB_GREP_LOG_LEVEL", "info")
	switch level {
	case "debug", "info", "warn", "error":
	default:
		return Config{}, fmt.Errorf("invalid WEB_GREP_LOG_LEVEL")
	}
	dev := os.Getenv("WEB_GREP_DEV") == "1" || os.Getenv("WEB_GREP_DEV") == "true" ||
		os.Getenv("NODE_ENV") == "development"
	cfg := Config{
		RootReal:       rootReal,
		RootLabel:      filepath.Base(rootReal),
		Host:           host,
		Port:           port,
		PublicHosts:    public,
		Token:          strings.TrimSpace(os.Getenv("WEB_GREP_TOKEN")),
		AllowSecrets:   allowSecrets,
		FollowSymlinks: follow,
		NoIgnore:       noIgnore,
		MaxResults:     maxRes,
		MaxResultsHard: maxHard,
		TimeoutMs:      timeout,
		PreviewBytes:   previewBytes,
		PreviewLines:   previewLines,
		Threads:        threads,
		MaxConcurrent:  maxConc,
		SearchZip:      searchZip,
		RgPath:         rgPath,
		LogLevel:       level,
		Dev:            dev,
		WebDist:        strings.TrimSpace(os.Getenv("WEB_GREP_WEB_DIST")),
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
	if cfg.Token == "" {
		return fmt.Errorf("refusing to bind %s without WEB_GREP_TOKEN", cfg.Host)
	}
	if len(cfg.PublicHosts) == 0 {
		return fmt.Errorf("0.0.0.0 is a bind address, not a Host. Set WEB_GREP_PUBLIC_HOST to the name/IP in the address bar")
	}
	return nil
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
			return nil, fmt.Errorf("WEB_GREP_PUBLIC_HOST must not include 0.0.0.0 (bind address, not a Host)")
		}
		hosts = append(hosts, host)
	}
	return hosts, nil
}

func resolveRoot(raw string) (string, error) {
	expanded := expandHome(raw)
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return "", fmt.Errorf("WEB_GREP_ROOT is not a readable directory: %s", raw)
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("WEB_GREP_ROOT is not a readable directory: %s", raw)
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("WEB_GREP_ROOT is not a readable directory: %s", raw)
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

func optional(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func parseInt(key string, fallback, min, max int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return 0, fmt.Errorf("invalid %s: %s", key, raw)
	}
	return n, nil
}

func parseBool(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	switch strings.ToLower(raw) {
	case "1", "true":
		return true, nil
	case "0", "false":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean value: %s", raw)
	}
}

func loadDotEnv() {
	start, err := os.Getwd()
	if err != nil {
		return
	}
	dir := start
	for {
		path := filepath.Join(dir, ".env")
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			applyDotEnv(path)
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}

func applyDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 {
			if (val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'') {
				val = val[1 : len(val)-1]
			}
		}
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
}
