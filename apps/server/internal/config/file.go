package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	ConfigEnvKey = "WEB_GREP_CONFIG"
	DefaultName  = "config.yaml"
)

type rawFile struct {
	Root           string   `yaml:"root"`
	Host           string   `yaml:"host"`
	Port           *int     `yaml:"port"`
	PublicHost     hostList `yaml:"public_host"`
	Token          string   `yaml:"token"`
	Rg             string   `yaml:"rg"`
	WebDist        string   `yaml:"web_dist"`
	Dev            *bool    `yaml:"dev"`
	LogLevel       string   `yaml:"log_level"`
	MaxResults     *int     `yaml:"max_results"`
	MaxResultsHard *int     `yaml:"max_results_hard"`
	TimeoutMs      *int     `yaml:"timeout_ms"`
	PreviewLines   *int     `yaml:"preview_lines"`
	Threads        *int     `yaml:"threads"`
	MaxConcurrent  *int     `yaml:"max_concurrent"`
	SearchZip      *bool    `yaml:"search_zip"`
	FollowSymlinks *bool    `yaml:"follow_symlinks"`
	NoIgnore       *bool    `yaml:"no_ignore"`
	AllowSecrets   *bool    `yaml:"allow_secrets"`
	PublicPath     string   `yaml:"public_path"`
}

type hostList []string

func (h *hostList) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		parsed, err := ParsePublicHosts(value.Value)
		if err != nil {
			return err
		}
		*h = parsed
		return nil
	case yaml.SequenceNode:
		var items []string
		if err := value.Decode(&items); err != nil {
			return err
		}
		var out []string
		for _, item := range items {
			parsed, err := ParsePublicHosts(item)
			if err != nil {
				return err
			}
			out = append(out, parsed...)
		}
		*h = out
		return nil
	default:
		if value.Tag == "!!null" || value.Kind == 0 {
			return nil
		}
		return fmt.Errorf("public_host must be a string or list")
	}
}

func readYAMLFile(path string) (rawFile, error) {
	var raw rawFile
	if path == "" {
		return raw, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return raw, fmt.Errorf("read config %s: %w", path, err)
	}
	if err := yaml.Unmarshal(b, &raw); err != nil {
		return raw, fmt.Errorf("parse config %s: %w", path, err)
	}
	return raw, nil
}

func findConfig(explicit string) (string, error) {
	if strings.TrimSpace(explicit) != "" {
		return strings.TrimSpace(explicit), nil
	}
	if v := strings.TrimSpace(os.Getenv(ConfigEnvKey)); v != "" {
		return v, nil
	}
	if p := walkForConfig(); p != "" {
		return p, nil
	}
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), DefaultName)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", nil
}

func walkForConfig() string {
	start, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := start
	for {
		path := filepath.Join(dir, DefaultName)
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			return path
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func applyEnv(raw *rawFile) error {
	if v, ok := lookupTrim(EnvRoot); ok {
		raw.Root = v
	}
	if v, ok := lookupTrim(EnvHost); ok {
		raw.Host = v
	}
	if err := envInt(EnvPort, &raw.Port); err != nil {
		return err
	}
	if v, ok := lookupTrim(EnvPublicPath); ok {
		raw.PublicPath = v
	}
	if v, ok := lookupTrim(EnvPublicHost); ok {
		parsed, err := ParsePublicHosts(v)
		if err != nil {
			return err
		}
		raw.PublicHost = parsed
	}
	if v, ok := lookupTrim(EnvToken); ok {
		raw.Token = v
	}
	if v, ok := lookupTrim(EnvRg); ok {
		raw.Rg = v
	}
	if v, ok := lookupTrim(EnvWebDist); ok {
		raw.WebDist = v
	}
	if err := envBool(EnvDev, &raw.Dev); err != nil {
		return err
	}
	if v, ok := lookupTrim(EnvLogLevel); ok {
		raw.LogLevel = v
	}
	if err := envInt(EnvMaxResults, &raw.MaxResults); err != nil {
		return err
	}
	if err := envInt(EnvMaxResultsHard, &raw.MaxResultsHard); err != nil {
		return err
	}
	if err := envInt(EnvTimeoutMs, &raw.TimeoutMs); err != nil {
		return err
	}
	if err := envInt(EnvPreviewLines, &raw.PreviewLines); err != nil {
		return err
	}
	if err := envInt(EnvThreads, &raw.Threads); err != nil {
		return err
	}
	if err := envInt(EnvMaxConcurrent, &raw.MaxConcurrent); err != nil {
		return err
	}
	if err := envBool(EnvSearchZip, &raw.SearchZip); err != nil {
		return err
	}
	if err := envBool(EnvFollowSymlinks, &raw.FollowSymlinks); err != nil {
		return err
	}
	if err := envBool(EnvNoIgnore, &raw.NoIgnore); err != nil {
		return err
	}
	if err := envBool(EnvAllowSecrets, &raw.AllowSecrets); err != nil {
		return err
	}
	return nil
}

func lookupTrim(key string) (string, bool) {
	v, ok := os.LookupEnv(key)
	if !ok {
		return "", false
	}
	v = strings.TrimSpace(v)
	if v == "" {
		return "", false
	}
	return v, true
}

func envInt(key string, dest **int) error {
	v, ok := lookupTrim(key)
	if !ok {
		return nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fmt.Errorf("invalid %s: %s", key, v)
	}
	*dest = &n
	return nil
}

func envBool(key string, dest **bool) error {
	v, ok := lookupTrim(key)
	if !ok {
		return nil
	}
	var b bool
	switch strings.ToLower(v) {
	case "1", "true":
		b = true
	case "0", "false":
		b = false
	default:
		return fmt.Errorf("invalid boolean value: %s", v)
	}
	*dest = &b
	return nil
}

func intOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}

func boolOr(p *bool, fallback bool) bool {
	if p == nil {
		return fallback
	}
	return *p
}
