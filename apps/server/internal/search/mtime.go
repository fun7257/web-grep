package search

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"web-grep/internal/sandbox"
)

func ListNewerFiles(rootReal, rel string, after time.Time, hidden, follow, allowSecrets bool) ([]string, error) {
	start := rootReal
	if rel != "" && rel != "." {
		start = filepath.Join(rootReal, filepath.FromSlash(rel))
	}
	var out []string
	err := filepath.WalkDir(start, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if name == ".git" && d.IsDir() {
			return filepath.SkipDir
		}
		if !hidden && strings.HasPrefix(name, ".") && name != "." && name != ".." {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		relPath, relErr := filepath.Rel(rootReal, p)
		if relErr != nil {
			return nil
		}
		posix := sandbox.ToPosixRel(relPath)
		if posix == "." || posix == "" {
			return nil
		}
		if sandbox.IsDenied(posix, allowSecrets) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, infoErr := d.Info()
		if follow {
			if st, e := os.Stat(p); e == nil {
				info = st
				infoErr = nil
			}
		}
		if infoErr != nil || info == nil {
			return nil
		}
		if !after.IsZero() && info.ModTime().Before(after) {
			return nil
		}
		out = append(out, posix)
		return nil
	})
	return out, err
}
