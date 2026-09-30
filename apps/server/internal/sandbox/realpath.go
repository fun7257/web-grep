package sandbox

import (
	"os"
	"path"
	"path/filepath"
	"strings"
)

// RealPathGuard answers whether a root-relative path still lands inside the
// root once symlinks are resolved. RelUnderRoot only checks the spelling of a
// path, so a hit under a symlinked directory that points outside the root
// (which rg follows when follow_symlinks is on) passes it. Use the guard on
// search hits to drop those.
//
// Directories are cached, so a search that hits many files in the same
// directories costs one Lstat per file plus one resolution per directory.
// A guard is not safe for concurrent use; make one per search.
type RealPathGuard struct {
	root     string
	dirs     map[string]bool
	lastRel  string
	lastSeen bool
	lastOK   bool
}

// NewRealPathGuard returns a guard for rootReal, which must already be
// symlink-resolved (config does this at boot).
func NewRealPathGuard(rootReal string) *RealPathGuard {
	return &RealPathGuard{root: rootReal, dirs: map[string]bool{}}
}

// Inside reports whether the POSIX relative path rel resolves under the root.
// A path that cannot be resolved (removed mid-search, broken link) is not
// inside.
func (g *RealPathGuard) Inside(rel string) bool {
	if rel == "" || rel == "." {
		return true
	}
	if g.lastSeen && g.lastRel == rel {
		return g.lastOK
	}
	ok := g.resolve(rel)
	g.lastRel, g.lastSeen, g.lastOK = rel, true, ok
	return ok
}

func (g *RealPathGuard) resolve(rel string) bool {
	if !g.dirInside(path.Dir(rel)) {
		return false
	}
	abs := filepath.Join(g.root, filepath.FromSlash(rel))
	info, err := os.Lstat(abs)
	if err != nil {
		return false
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return true
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return false
	}
	return withinRoot(g.root, real)
}

func (g *RealPathGuard) dirInside(dir string) bool {
	if dir == "." || dir == "" {
		return true
	}
	if v, ok := g.dirs[dir]; ok {
		return v
	}
	real, err := filepath.EvalSymlinks(filepath.Join(g.root, filepath.FromSlash(dir)))
	ok := err == nil && withinRoot(g.root, real)
	g.dirs[dir] = ok
	return ok
}

func withinRoot(root, real string) bool {
	rel, err := filepath.Rel(root, real)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && !filepath.IsAbs(rel)
}
