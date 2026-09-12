package rg

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func Detect(override string) string {
	if override != "" && filepath.IsAbs(override) {
		if isExe(override) {
			return override
		}
	}
	if p := walkPATH(); p != "" {
		return p
	}
	return findBundled()
}

func walkPATH() string {
	names := []string{"rg"}
	if runtime.GOOS == "windows" {
		names = []string{"rg.exe", "rg"}
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir == "" {
			continue
		}
		for _, name := range names {
			cand := filepath.Join(dir, name)
			if isExe(cand) {
				return cand
			}
		}
	}
	return ""
}

func vscodePlatArch() (plat, arch string) {
	plat = runtime.GOOS
	if plat == "windows" {
		plat = "win32"
	}
	switch runtime.GOARCH {
	case "amd64":
		arch = "x64"
	case "arm64":
		arch = "arm64"
	case "arm":
		arch = "arm"
	case "386":
		arch = "ia32"
	case "ppc64le":
		arch = "ppc64"
	case "riscv64":
		arch = "riscv64"
	case "s390x":
		arch = "s390x"
	default:
		arch = runtime.GOARCH
	}
	return plat, arch
}

func findBundled() string {
	plat, arch := vscodePlatArch()
	bin := "rg"
	if runtime.GOOS == "windows" {
		bin = "rg.exe"
	}
	pkg := "@vscode/ripgrep-" + plat + "-" + arch
	start, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := start
	for {
		candidates := []string{
			filepath.Join(dir, "node_modules", pkg, "bin", bin),
		}
		matches, _ := filepath.Glob(filepath.Join(dir, "node_modules", ".pnpm", "@vscode+ripgrep-"+plat+"-"+arch+"@*", "node_modules", pkg, "bin", bin))
		candidates = append(candidates, matches...)
		for _, c := range candidates {
			if isExe(c) {
				return c
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func isExe(path string) bool {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return st.Mode()&0o111 != 0
}

func Version(rgBin string) string {
	cmd := exec.Command(rgBin, "--no-config", "--version")
	cmd.Env = Env()
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	line, _, _ := strings.Cut(string(out), "\n")
	return strings.TrimSpace(line)
}

func Env() []string {
	env := []string{
		"LANG=" + fallback(os.Getenv("LANG"), "C.UTF-8"),
		"LC_ALL=" + fallback(os.Getenv("LC_ALL"), "C.UTF-8"),
	}
	if p := os.Getenv("PATH"); p != "" {
		env = append(env, "PATH="+p)
	}
	return env
}

func fallback(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func ProbeVersion(rgBin string) string {
	done := make(chan string, 1)
	go func() { done <- Version(rgBin) }()
	select {
	case v := <-done:
		return v
	case <-time.After(2 * time.Second):
		return ""
	}
}
