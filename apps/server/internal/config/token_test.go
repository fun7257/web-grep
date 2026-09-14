package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseTokenHashesPlaintextOnce(t *testing.T) {
	hash, plain := parseToken("secret1")
	if !plain {
		t.Fatal("expected plaintext")
	}
	if hash != HashPassword("secret1") {
		t.Fatalf("hash %s", hash)
	}
	again, plainAgain := parseToken("sha256:" + hash)
	if plainAgain || again != hash {
		t.Fatalf("prefixed: hash=%s plain=%v", again, plainAgain)
	}
	bare, barePlain := parseToken(hash)
	if barePlain || bare != hash {
		t.Fatalf("bare hex: hash=%s plain=%v", bare, barePlain)
	}
}

func TestPasswordMatches(t *testing.T) {
	hash := HashPassword("secret1")
	if !PasswordMatches(hash, "secret1") {
		t.Fatal("expected match")
	}
	if PasswordMatches(hash, "secret2") {
		t.Fatal("unexpected match")
	}
	if PasswordMatches("", "secret1") {
		t.Fatal("empty hash must not match")
	}
}

func TestSealRewritesYAMLToken(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	original := "# keep me\nroot: /tmp\ntoken: \"plain-pass\"\nhost: 127.0.0.1\n"
	if err := os.WriteFile(path, []byte(original), 0o640); err != nil {
		t.Fatal(err)
	}
	cfg := Config{
		TokenHash:  HashPassword("plain-pass"),
		ConfigPath: path,
		sealToken:  true,
	}
	rewrote, err := cfg.SealToken()
	if err != nil {
		t.Fatal(err)
	}
	if !rewrote {
		t.Fatal("expected rewrite")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, "plain-pass") {
		t.Fatalf("plaintext remains: %s", text)
	}
	want := "token: sha256:" + cfg.TokenHash
	if !strings.Contains(text, want) {
		t.Fatalf("missing hash line: %s", text)
	}
	if !strings.Contains(text, "# keep me") || !strings.Contains(text, "root: /tmp") {
		t.Fatalf("lost other lines: %s", text)
	}
}

func TestLoadYAMLAndEnvOverride(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "root")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	plain := "plain-pass"
	yaml := "root: " + root + "\nhost: 127.0.0.1\nport: 8787\ntoken: " + plain + "\nlog_level: warn\n"
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	clearConfigEnv(t)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	want := HashPassword(plain)
	if cfg.TokenHash != want {
		t.Fatalf("TokenHash=%s want %s", cfg.TokenHash, want)
	}
	if cfg.LogLevel != "warn" {
		t.Fatalf("log_level=%s", cfg.LogLevel)
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), "token: "+plain) {
		t.Fatal("Load must not rewrite yaml; SealToken does that")
	}
	rewrote, err := cfg.SealToken()
	if err != nil || !rewrote {
		t.Fatalf("seal: rewrote=%v err=%v", rewrote, err)
	}

	t.Setenv(EnvLogLevel, "debug")
	t.Setenv(EnvToken, "from-env")
	over, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if over.LogLevel != "debug" {
		t.Fatalf("env log_level=%s", over.LogLevel)
	}
	if over.TokenHash != HashPassword("from-env") {
		t.Fatal("env token should override yaml")
	}
	if over.sealToken {
		t.Fatal("env token must not rewrite yaml")
	}
}

func TestRewriteYAMLSkipsComments(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	original := "# token: not-this\ntoken: plain\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := rewriteYAMLScalar(path, "token", "sha256:abc"); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	text := string(raw)
	if !strings.Contains(text, "# token: not-this") {
		t.Fatalf("comment rewritten: %s", text)
	}
	if !strings.Contains(text, "token: sha256:abc") {
		t.Fatalf("assignment not rewritten: %s", text)
	}
}

func TestPublicHostListAndString(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "root")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "config.yaml")
	body := "root: " + root + "\nhost: 0.0.0.0\ntoken: secret1\npublic_host:\n  - 127.0.0.1\n  - test.local\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	clearConfigEnv(t)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.PublicHosts) != 2 || cfg.PublicHosts[1] != "test.local" {
		t.Fatalf("%v", cfg.PublicHosts)
	}
}

func clearConfigEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		ConfigEnvKey, EnvRoot, EnvHost, EnvPort, EnvPublicHost, EnvToken, EnvRg,
		EnvWebDist, EnvDev, EnvLogLevel, EnvMaxResults, EnvMaxResultsHard,
		EnvTimeoutMs, EnvPreviewLines, EnvThreads, EnvMaxConcurrent,
		EnvSearchZip, EnvFollowSymlinks, EnvNoIgnore, EnvAllowSecrets,
	}
	for _, k := range keys {
		t.Setenv(k, "")
		_ = os.Unsetenv(k)
	}
}
