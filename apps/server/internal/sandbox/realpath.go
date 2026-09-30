package sandbox

import (
	"os"
	"path"
	"path/filepath"
	"strings"
)

// RealPathGuard answers whether a root-relative path still lands inside the
// root once symlinks are resolved, and what that path's canonical spelling is.
// RelUnderRoot only checks how a path is spelled, so a hit under a symlinked
// directory that points outside the root (which rg follows when follow_symlinks
// is on) passes it. Use the guard on search hits to drop those, and to collapse
// several spellings of one real file.
//
// Directories are cached, so a search that hits many files in the same
// directories costs one Lstat per file plus one resolution per directory.
// A file that is not itself a symlink reuses that directory result and does
// not call EvalSymlinks on the file. A guard is not safe for concurrent use;
// make one per search.
type RealPathGuard struct {
	root      string
	dirs      map[string]dirCache
	lastRel   string
	lastSeen  bool
	lastOK    bool
	lastCanon string
}

// dirCache is one resolved root-relative directory.
// canon is empty when the directory resolves to the root itself.
type dirCache struct {
	ok    bool
	canon string
}

// NewRealPathGuard returns a guard for rootReal, which must already be
// symlink-resolved (config does this at boot).
func NewRealPathGuard(rootReal string) *RealPathGuard {
	return &RealPathGuard{root: rootReal, dirs: map[string]dirCache{}}
}

// Inside reports whether the POSIX relative path rel resolves under the root.
// A path that cannot be resolved (removed mid-search, broken link) is not
// inside.
func (g *RealPathGuard) Inside(rel string) bool {
	_, ok := g.Canonical(rel)
	return ok
}

// Canonical returns the symlink-resolved path of rel relative to the root,
// as a POSIX path. ok is false when rel lands outside the root or cannot be
// resolved. The root itself ("", ".") yields ("", true).
//
// A non-symlink whose ancestors are already canonical returns rel unchanged.
// That path costs the guard's usual one Lstat and no further system call;
// repeating it returns the cached result.
func (g *RealPathGuard) Canonical(rel string) (canonRel string, ok bool) {
	if rel == "" || rel == "." {
		return "", true
	}
	if g.lastSeen && g.lastRel == rel {
		return g.lastCanon, g.lastOK
	}
	canonRel, ok = g.resolveCanon(rel)
	g.lastRel, g.lastSeen, g.lastOK, g.lastCanon = rel, true, ok, canonRel
	return canonRel, ok
}

func (g *RealPathGuard) resolveCanon(rel string) (string, bool) {
	dir := path.Dir(rel)
	dirCanon, ok := g.dirCanon(dir)
	if !ok {
		return "", false
	}
	abs := filepath.Join(g.root, filepath.FromSlash(rel))
	info, err := os.Lstat(abs)
	if err != nil {
		return "", false
	}
	if info.Mode()&os.ModeSymlink == 0 {
		// Ancestors were resolved in the directory cache. This entry is not
		// a link, so its real path is that directory plus the final name.
		if dirCanon == "" {
			return path.Base(rel), true
		}
		if dirCanon == dir {
			return rel, true
		}
		return dirCanon + "/" + path.Base(rel), true
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", false
	}
	return posixRel(g.root, real)
}

func (g *RealPathGuard) dirCanon(dir string) (string, bool) {
	if dir == "." || dir == "" {
		return "", true
	}
	if v, found := g.dirs[dir]; found {
		return v.canon, v.ok
	}
	real, err := filepath.EvalSymlinks(filepath.Join(g.root, filepath.FromSlash(dir)))
	if err != nil {
		g.dirs[dir] = dirCache{}
		return "", false
	}
	canon, ok := posixRel(g.root, real)
	if !ok {
		g.dirs[dir] = dirCache{}
		return "", false
	}
	g.dirs[dir] = dirCache{ok: true, canon: canon}
	return canon, true
}

// posixRel is the slash-separated path of real relative to root.
// The root itself is ("", true). Anything outside is ("", false).
func posixRel(root, real string) (string, bool) {
	rel, err := filepath.Rel(root, real)
	if err != nil {
		return "", false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", false
	}
	if rel == "." {
		return "", true
	}
	return filepath.ToSlash(rel), true
}
