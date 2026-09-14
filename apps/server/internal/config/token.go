package config

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"os"
	"strings"
)

const tokenHashPrefix = "sha256:"

func HashPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

func PasswordMatches(hash, password string) bool {
	if hash == "" {
		return false
	}
	got := HashPassword(password)
	if len(got) != len(hash) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hash), []byte(got)) == 1
}

func parseToken(raw string) (hash string, plain bool) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", false
	}
	lower := strings.ToLower(v)
	if strings.HasPrefix(lower, tokenHashPrefix) {
		hexPart := lower[len(tokenHashPrefix):]
		if isSHA256Hex(hexPart) {
			return hexPart, false
		}
	}
	if isSHA256Hex(lower) {
		return lower, false
	}
	return HashPassword(v), true
}

func isSHA256Hex(s string) bool {
	if len(s) != 64 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}

func hashedTokenValue(hash string) string {
	return tokenHashPrefix + hash
}

func (c Config) SealToken() (bool, error) {
	if !c.sealToken || c.ConfigPath == "" || c.TokenHash == "" {
		return false, nil
	}
	return rewriteYAMLScalar(c.ConfigPath, "token", hashedTokenValue(c.TokenHash))
}

func rewriteYAMLScalar(path, key, value string) (bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(path)
	mode := os.FileMode(0o600)
	if err == nil {
		mode = info.Mode().Perm()
	}
	lines := strings.Split(string(raw), "\n")
	changed := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		body := strings.TrimSpace(line)
		k, _, ok := strings.Cut(body, ":")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		leadLen := len(line) - len(strings.TrimLeft(line, " \t"))
		lead := line[:leadLen]
		next := lead + key + ": " + value
		if next == line {
			continue
		}
		lines[i] = next
		changed = true
	}
	if !changed {
		return false, nil
	}
	out := strings.Join(lines, "\n")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(out), mode); err != nil {
		return false, err
	}
	if err := os.Rename(tmp, path); err != nil {
		// Bind-mounted files cannot be renamed over (device or resource busy).
		if err2 := os.WriteFile(path, []byte(out), mode); err2 != nil {
			_ = os.Remove(tmp)
			return false, err
		}
		_ = os.Remove(tmp)
	}
	return true, nil
}
