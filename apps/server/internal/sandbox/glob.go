package sandbox

import "regexp"

// CompileHitFilter returns a reusable path predicate: match any include
// (if given), none of the exclude globs, and any of the and globs (if
// given). Empty slices are no-ops. Compile once per search; do not call
// FilterByGlobs per hit.
func CompileHitFilter(include, exclude, and []string) func(string) bool {
	var inc, exc, andM func(string) bool
	if len(include) > 0 {
		inc = NewGlobMatcher(include)
	}
	if len(exclude) > 0 {
		exc = NewGlobMatcher(exclude)
	}
	if len(and) > 0 {
		andM = NewGlobMatcher(and)
	}
	if inc == nil && exc == nil && andM == nil {
		return func(string) bool { return true }
	}
	return func(path string) bool {
		if inc != nil && !inc(path) {
			return false
		}
		if exc != nil && exc(path) {
			return false
		}
		if andM != nil && !andM(path) {
			return false
		}
		return true
	}
}

// FilterByGlobs keeps files that match any include glob (if given) and
// none of the exclude globs. Patterns follow ripgrep/gitignore rules:
// a glob without a slash matches the basename in any directory.
func FilterByGlobs(files, include, exclude []string) []string {
	if len(files) == 0 || (len(include) == 0 && len(exclude) == 0) {
		return files
	}
	inc := compileUserGlobs(include)
	exc := compileUserGlobs(exclude)
	out := make([]string, 0, len(files))
	for _, file := range files {
		if len(inc) > 0 && !anyGlobMatch(inc, file) {
			continue
		}
		if anyGlobMatch(exc, file) {
			continue
		}
		out = append(out, file)
	}
	return out
}

// NewGlobMatcher compiles pats once. The returned func is true when path
// matches any pattern. An empty pattern list never matches.
func NewGlobMatcher(pats []string) func(string) bool {
	res := compileUserGlobs(pats)
	if len(res) == 0 {
		return func(string) bool { return false }
	}
	return func(path string) bool {
		return anyGlobMatch(res, path)
	}
}

func compileUserGlobs(pats []string) []*regexp.Regexp {
	out := make([]*regexp.Regexp, 0, len(pats))
	for _, pat := range pats {
		if re := userGlobRegexp(pat); re != nil {
			out = append(out, re)
		}
	}
	return out
}

func anyGlobMatch(res []*regexp.Regexp, path string) bool {
	for _, re := range res {
		if re.MatchString(path) {
			return true
		}
	}
	return false
}

func userGlobRegexp(pat string) *regexp.Regexp {
	trimmed := trimGlob(pat)
	if trimmed == "" {
		return nil
	}
	anchored := trimmed[0] == '/'
	if anchored {
		trimmed = trimmed[1:]
		if trimmed == "" {
			return nil
		}
	}
	core := trimTrailingSlashes(trimmed)
	// Literals are exact paths (tree picks). Only unanchored wildcards
	// like *.log match the basename in any directory.
	if !anchored && !containsSlash(core) && hasGlobMeta(core) {
		trimmed = "**/" + trimmed
	}
	return globToRegexp(trimmed)
}

// ToRgGlob converts a user glob to a ripgrep --glob pattern with the
// same semantics as FilterByGlobs: a slash-free literal is an exact
// root-relative path (tree pick), not a basename match in any directory.
func ToRgGlob(g string) string {
	trimmed := trimGlob(g)
	if trimmed == "" {
		return trimmed
	}
	if trimmed[0] == '/' {
		return trimmed
	}
	core := trimTrailingSlashes(trimmed)
	if !containsSlash(core) && !hasGlobMeta(core) {
		return "/" + trimmed
	}
	return trimmed
}

func hasGlobMeta(pat string) bool {
	for i := 0; i < len(pat); i++ {
		switch pat[i] {
		case '*', '?', '[':
			return true
		}
	}
	return false
}

func trimGlob(pat string) string {
	start, end := 0, len(pat)
	for start < end && (pat[start] == ' ' || pat[start] == '\t') {
		start++
	}
	for end > start && (pat[end-1] == ' ' || pat[end-1] == '\t') {
		end--
	}
	return pat[start:end]
}

func trimTrailingSlashes(pat string) string {
	end := len(pat)
	for end > 0 && pat[end-1] == '/' {
		end--
	}
	return pat[:end]
}

func containsSlash(pat string) bool {
	for i := 0; i < len(pat); i++ {
		if pat[i] == '/' {
			return true
		}
	}
	return false
}
