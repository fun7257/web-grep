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

type Filter struct {
	After   time.Time
	Include []string
	Exclude []string
}

func List(rootReal, userRel string, allowSecrets bool, filter Filter) (Listing, error) {
	filter.Include = cleanGlobs(filter.Include)
	filter.Exclude = cleanGlobs(filter.Exclude)
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

	after := filter.After
	needDirFilter := !after.IsZero() || len(filter.Include) > 0 || len(filter.Exclude) > 0
	var keepDirs map[string]struct{}
	if needDirFilter {
		keepDirs = dirsWithPassingFiles(rootReal, resolved.Abs, after, allowSecrets, filter.Include, filter.Exclude)
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
		if isDir {
			if needDirFilter {
				if _, ok := keepDirs[childRel]; !ok {
					continue
				}
			}
		} else if !filePasses(childRel, after, mtime, infoErr, filter.Include, filter.Exclude) {
			continue
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

func CountFiles(rootReal, userRel string, allowSecrets bool, filter Filter) (int, error) {
	filter.Include = cleanGlobs(filter.Include)
	filter.Exclude = cleanGlobs(filter.Exclude)
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
		posix := sandbox.ToPosixRel(resolved.Rel)
		if posix == "" || posix == "." {
			posix = filepath.Base(resolved.Abs)
		}
		if !filePasses(posix, filter.After, st.ModTime(), nil, filter.Include, filter.Exclude) {
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
		if !filePasses(posix, filter.After, info.ModTime(), infoErr, filter.Include, filter.Exclude) {
			return nil
		}
		n++
		return nil
	})
	return n, err
}

func cleanGlobs(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, g := range raw {
		clean, err := sandbox.SanitizeUserGlob(g)
		if err != nil || clean == "" {
			continue
		}
		out = append(out, clean)
	}
	return out
}

func filePasses(posix string, after time.Time, mtime time.Time, infoErr error, include, exclude []string) bool {
	if infoErr != nil {
		return false
	}
	if len(exclude) > 0 && len(sandbox.FilterByGlobs([]string{posix}, nil, exclude)) == 0 {
		return false
	}
	if !after.IsZero() && mtime.Before(after) {
		return false
	}
	if len(include) == 0 {
		return true
	}
	return len(sandbox.FilterByGlobs([]string{posix}, include, nil)) == 1
}

func dirsWithPassingFiles(rootReal, startAbs string, after time.Time, allowSecrets bool, include, exclude []string) map[string]struct{} {
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
		mtime := time.Time{}
		if infoErr == nil {
			mtime = info.ModTime()
		}
		if !filePasses(posix, after, mtime, infoErr, include, exclude) {
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
