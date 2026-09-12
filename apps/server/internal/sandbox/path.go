package sandbox

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

var ErrInvalidPath = errors.New("invalid path")

type Resolved struct {
	Abs string
	Rel string // POSIX
}

func ToPosixRel(rel string) string {
	return strings.ReplaceAll(rel, `\`, "/")
}

func JoinUnderRoot(rootReal, userRel string) (string, error) {
	if strings.ContainsRune(userRel, 0) {
		return "", ErrInvalidPath
	}
	trimmed := strings.TrimSpace(userRel)
	input := trimmed
	if trimmed == "" || trimmed == "." {
		input = ""
	}
	if input != "" && filepath.IsAbs(input) {
		return "", ErrInvalidPath
	}
	joined := rootReal
	if input != "" {
		joined = filepath.Join(rootReal, input)
	}
	rel, err := filepath.Rel(rootReal, joined)
	if err != nil {
		return "", ErrInvalidPath
	}
	if rel != "." && (rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel)) {
		return "", ErrInvalidPath
	}
	return joined, nil
}

// RelUnderRoot maps a relative path into the root without stat/symlink
// resolution. Use on the search hot path; preview/tree still use ResolveUnderRoot.
func RelUnderRoot(rootReal, userRel string) (string, error) {
	joined, err := JoinUnderRoot(rootReal, userRel)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(rootReal, joined)
	if err != nil {
		return "", ErrInvalidPath
	}
	if rel != "." && (rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel)) {
		return "", ErrInvalidPath
	}
	if rel == "." {
		return "", nil
	}
	return ToPosixRel(rel), nil
}

func ResolveUnderRoot(rootReal, userRel string) (Resolved, error) {
	joined, err := JoinUnderRoot(rootReal, userRel)
	if err != nil {
		return Resolved{}, err
	}
	if _, err := os.Lstat(joined); err != nil {
		return Resolved{}, ErrInvalidPath
	}
	abs, err := filepath.EvalSymlinks(joined)
	if err != nil {
		return Resolved{}, ErrInvalidPath
	}
	relReal, err := filepath.Rel(rootReal, abs)
	if err != nil {
		return Resolved{}, ErrInvalidPath
	}
	if relReal != "." && (relReal == ".." || strings.HasPrefix(relReal, ".."+string(os.PathSeparator)) || filepath.IsAbs(relReal)) {
		return Resolved{}, ErrInvalidPath
	}
	if relReal == "." {
		relReal = ""
	}
	return Resolved{Abs: abs, Rel: ToPosixRel(relReal)}, nil
}
