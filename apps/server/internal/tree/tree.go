package tree

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"web-grep/internal/sandbox"
)

const maxEntries = 2000

var skipNames = map[string]struct{}{
	".git":         {},
	".vite":        {},
	".idea":        {},
	".output":      {},
	".turbo":       {},
	".DS_Store":    {},
	"node_modules": {},
	"dist":         {},
	"coverage":     {},
	"target":       {},
}

type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Dir  bool   `json:"dir"`
}

type Listing struct {
	Path      string  `json:"path"`
	Entries   []Entry `json:"entries"`
	Truncated bool    `json:"truncated"`
}

func List(rootReal, userRel string, allowSecrets bool, after time.Time) (Listing, error) {
	resolved, err := sandbox.ResolveUnderRoot(rootReal, userRel)
	if err != nil {
		return Listing{}, err
	}
	st, err := os.Lstat(resolved.Abs)
	if err != nil || !st.IsDir() {
		return Listing{}, sandbox.ErrInvalidPath
	}
	if st.Mode()&os.ModeSymlink != 0 {
		return Listing{}, sandbox.ErrInvalidPath
	}

	dirents, err := os.ReadDir(resolved.Abs)
	if err != nil {
		return Listing{}, err
	}

	var recentDirs map[string]struct{}
	if !after.IsZero() {
		recentDirs = dirsWithRecentFiles(rootReal, resolved.Abs, after, allowSecrets)
	}

	type ranked struct {
		entry Entry
		mtime time.Time
	}
	rankedEntries := make([]ranked, 0, len(dirents))
	for _, d := range dirents {
		name := d.Name()
		if name == "" || name == "." || name == ".." {
			continue
		}
		if _, skip := skipNames[name]; skip {
			continue
		}
		if d.Type()&os.ModeSymlink != 0 {
			continue
		}
		childRel := name
		if resolved.Rel != "" {
			childRel = path.Join(resolved.Rel, name)
		}
		if sandbox.IsDenied(childRel, allowSecrets) {
			continue
		}
		isDir := d.IsDir()
		info, infoErr := d.Info()
		var mtime time.Time
		if infoErr == nil {
			mtime = info.ModTime()
		}
		if !after.IsZero() {
			if isDir {
				if _, ok := recentDirs[childRel]; !ok {
					continue
				}
			} else if infoErr != nil || mtime.Before(after) {
				continue
			}
		}
		rankedEntries = append(rankedEntries, ranked{
			entry: Entry{Name: name, Path: childRel, Dir: isDir},
			mtime: mtime,
		})
	}
	sort.SliceStable(rankedEntries, func(i, j int) bool {
		if rankedEntries[i].entry.Dir != rankedEntries[j].entry.Dir {
			return rankedEntries[i].entry.Dir
		}
		if !rankedEntries[i].mtime.Equal(rankedEntries[j].mtime) {
			return rankedEntries[i].mtime.After(rankedEntries[j].mtime)
		}
		return strings.ToLower(rankedEntries[i].entry.Name) < strings.ToLower(rankedEntries[j].entry.Name)
	})
	truncated := false
	if len(rankedEntries) > maxEntries {
		rankedEntries = rankedEntries[:maxEntries]
		truncated = true
	}
	entries := make([]Entry, len(rankedEntries))
	for i, item := range rankedEntries {
		entries[i] = item.entry
	}
	return Listing{Path: resolved.Rel, Entries: entries, Truncated: truncated}, nil
}

func CountFiles(rootReal, userRel string, allowSecrets bool, after time.Time) (int, error) {
	resolved, err := sandbox.ResolveUnderRoot(rootReal, userRel)
	if err != nil {
		return 0, err
	}
	st, err := os.Lstat(resolved.Abs)
	if err != nil {
		return 0, sandbox.ErrInvalidPath
	}
	if !st.IsDir() {
		if st.Mode()&os.ModeSymlink != 0 {
			return 0, nil
		}
		if !after.IsZero() && st.ModTime().Before(after) {
			return 0, nil
		}
		return 1, nil
	}
	n := 0
	err = filepath.WalkDir(resolved.Abs, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		name := d.Name()
		if name == "." || name == ".." {
			return nil
		}
		if _, skip := skipNames[name]; skip {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		rel, relErr := filepath.Rel(rootReal, p)
		if relErr != nil {
			return nil
		}
		posix := sandbox.ToPosixRel(rel)
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
		if infoErr != nil {
			return nil
		}
		if !after.IsZero() && info.ModTime().Before(after) {
			return nil
		}
		n++
		return nil
	})
	return n, err
}

func dirsWithRecentFiles(rootReal, startAbs string, after time.Time, allowSecrets bool) map[string]struct{} {
	out := make(map[string]struct{})
	_ = filepath.WalkDir(startAbs, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if name == "." || name == ".." {
			return nil
		}
		if _, skip := skipNames[name]; skip {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		rel, relErr := filepath.Rel(rootReal, p)
		if relErr != nil {
			return nil
		}
		posix := sandbox.ToPosixRel(rel)
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
		if infoErr != nil || info.ModTime().Before(after) {
			return nil
		}
		dir := path.Dir(posix)
		for dir != "." && dir != "/" && dir != "" {
			out[dir] = struct{}{}
			parent := path.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
		return nil
	})
	return out
}
