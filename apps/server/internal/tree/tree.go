package tree

import (
	"os"
	"path"
	"sort"
	"strings"

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

func List(rootReal, userRel string, allowSecrets bool) (Listing, error) {
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

	entries := make([]Entry, 0, len(dirents))
	truncated := false
	for _, d := range dirents {
		if len(entries) >= maxEntries {
			truncated = true
			break
		}
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
		entries = append(entries, Entry{Name: name, Path: childRel, Dir: isDir})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Dir != entries[j].Dir {
			return entries[i].Dir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return Listing{Path: resolved.Rel, Entries: entries, Truncated: truncated}, nil
}
