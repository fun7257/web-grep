package rg

import (
	"fmt"
	"path/filepath"

	"web-grep/internal/sandbox"
)

type AndTerm struct {
	Query         string
	Regex         bool
	CaseSensitive bool
	WordMatch     bool
}

type Input struct {
	RootReal       string
	RelativeDir    string
	Query          string
	Regex          bool
	CaseSensitive  bool
	WordMatch      bool
	Hidden         bool
	GlobInclude    []string
	GlobExclude    []string
	AllowSecrets   bool
	FollowSymlinks bool
	NoIgnore       bool
	SearchZip      bool
	Threads        int
	FileList       []string
	LimitToList    bool
	AndTerms       []AndTerm
}

func BuildArgv(in Input) ([]string, error) {
	if filepath.IsAbs(in.RelativeDir) {
		return nil, fmt.Errorf("relativeDir must not be absolute")
	}
	argv := []string{
		"--no-config",
		"--json",
		"--line-number",
		"--with-filename",
		"--no-heading",
	}
	if in.Threads > 0 {
		argv = append(argv, "--threads", fmt.Sprintf("%d", in.Threads))
	}
	if !in.Regex {
		argv = append(argv, "-F")
	}
	if in.CaseSensitive {
		argv = append(argv, "-s")
	} else {
		argv = append(argv, "-i")
	}
	if in.WordMatch {
		argv = append(argv, "-w")
	}
	if in.Hidden {
		argv = append(argv, "--hidden")
	}
	if in.FollowSymlinks {
		argv = append(argv, "--follow")
	}
	if in.NoIgnore {
		argv = append(argv, "--no-ignore")
	}
	if in.SearchZip {
		argv = append(argv, "--search-zip")
	}
	if !in.LimitToList {
		argv = append(argv, "--glob", "!.git/**")
		for _, g := range in.GlobInclude {
			argv = append(argv, "--glob", g)
		}
		for _, g := range in.GlobExclude {
			argv = append(argv, "--glob", "!"+g)
		}
		for _, g := range sandbox.DenylistRgGlobs(in.AllowSecrets, len(in.GlobInclude) > 0) {
			argv = append(argv, "--glob", g)
		}
	}
	// -e makes every remaining positional a PATH, so a pre-filtered file
	// list never searches the rest of the tree. rg 15 has no --files-from.
	if in.LimitToList {
		argv = append(argv, "-e", in.Query, "--")
		return argv, nil
	}
	if in.RelativeDir == "." || in.RelativeDir == "" {
		argv = append(argv, "--", in.Query)
	} else {
		argv = append(argv, "--", in.Query, in.RelativeDir)
	}
	return argv, nil
}

func BuildFilterArgv(term AndTerm) []string {
	argv := []string{"--no-config"}
	if !term.Regex {
		argv = append(argv, "-F")
	}
	if term.CaseSensitive {
		argv = append(argv, "-s")
	} else {
		argv = append(argv, "-i")
	}
	if term.WordMatch {
		argv = append(argv, "-w")
	}
	return append(argv, "--", term.Query)
}
