package sandbox

import (
	"errors"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var ErrInvalidGlob = errors.New("invalid glob")

var denyGlobs = []string{
	".env",
	".env.*",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"*.keystore",
	"id_rsa",
	"id_rsa.*",
	"id_dsa",
	"id_ed25519",
	"*.pypirc",
	".npmrc",
	"credentials.json",
	"**/secrets.yaml",
	"**/secrets.yml",
	".git/**",
}

var (
	denyOnce     sync.Once
	denyMatchers []*regexp.Regexp
	envExample   *regexp.Regexp
)

func compileDenylist() {
	denyMatchers = make([]*regexp.Regexp, 0, len(denyGlobs))
	for _, g := range denyGlobs {
		denyMatchers = append(denyMatchers, globToRegexp(g))
	}
	envExample = globToRegexp(".env.example")
}

func IsDenied(relPosix string, allowSecrets bool) bool {
	if allowSecrets {
		return false
	}
	denyOnce.Do(compileDenylist)
	base := path.Base(relPosix)
	if envExample.MatchString(base) {
		return false
	}
	for _, re := range denyMatchers {
		if re.MatchString(relPosix) || re.MatchString(base) {
			return true
		}
	}
	return false
}

func DenylistRgGlobs(allowSecrets, hasUserInclude bool) []string {
	if allowSecrets {
		return nil
	}
	out := make([]string, 0, len(denyGlobs)+1)
	for _, g := range denyGlobs {
		out = append(out, "!"+g)
	}
	if hasUserInclude {
		out = append(out, ".env.example")
	}
	return out
}

func SanitizeUserGlob(glob string) (string, error) {
	if strings.ContainsRune(glob, 0) || strings.ContainsAny(glob, "\n\r") {
		return "", ErrInvalidGlob
	}
	trimmed := strings.TrimSpace(glob)
	if trimmed == "" {
		return "", ErrInvalidGlob
	}
	if strings.HasPrefix(trimmed, "!") {
		return "", ErrInvalidGlob
	}
	if strings.HasPrefix(trimmed, "--") {
		return "", ErrInvalidGlob
	}
	if filepath.IsAbs(trimmed) {
		return "", ErrInvalidGlob
	}
	for _, seg := range strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '/' || r == '\\'
	}) {
		if seg == ".." {
			return "", ErrInvalidGlob
		}
	}
	return trimmed, nil
}

func globToRegexp(pat string) *regexp.Regexp {
	var b strings.Builder
	b.WriteByte('^')
	i := 0
	for i < len(pat) {
		if i+1 < len(pat) && pat[i] == '*' && pat[i+1] == '*' {
			if i+2 < len(pat) && pat[i+2] == '/' {
				b.WriteString("(?:.*/)?")
				i += 3
				continue
			}
			b.WriteString(".*")
			i += 2
			continue
		}
		switch pat[i] {
		case '*':
			b.WriteString("[^/]*")
		case '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(pat[i])))
		}
		i++
	}
	b.WriteByte('$')
	return regexp.MustCompile(b.String())
}
