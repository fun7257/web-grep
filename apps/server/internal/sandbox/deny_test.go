package sandbox

import "testing"

func TestIsDenied(t *testing.T) {
	if !IsDenied("foo.pem", false) || !IsDenied("certs/foo.pem", false) {
		t.Fatal("*.pem")
	}
	if IsDenied(".env.example", false) || IsDenied("config/.env.example", false) {
		t.Fatal(".env.example should be allowed")
	}
	if !IsDenied(".env", false) {
		t.Fatal(".env")
	}
	if IsDenied(".env", true) || IsDenied("foo.pem", true) {
		t.Fatal("allowSecrets")
	}
	if IsDenied("app-secret.log", false) || IsDenied("credential-rotation.json", false) {
		t.Fatal("broad *secret*/*credential* globs should not apply")
	}
}

func TestSanitizeUserGlob(t *testing.T) {
	if _, err := SanitizeUserGlob("--help"); err == nil {
		t.Fatal("expected --help reject")
	}
	if _, err := SanitizeUserGlob("!.env"); err == nil {
		t.Fatal("expected ! reject")
	}
	got, err := SanitizeUserGlob("**/a")
	if err != nil || got != "**/a" {
		t.Fatalf("got %q %v", got, err)
	}
	named, err := SanitizeUserGlob("foo--bar.txt")
	if err != nil || named != "foo--bar.txt" {
		t.Fatalf("dash-dash name: %q %v", named, err)
	}
	if _, err := SanitizeUserGlob("foo/../bar"); err == nil {
		t.Fatal("expected parent segment reject")
	}
	escaped, err := SanitizeUserGlob(`..\[id\]`)
	if err != nil || escaped != `..\[id\]` {
		t.Fatalf("escaped dot-dot name: %q %v", escaped, err)
	}
	star, err := SanitizeUserGlob(`..\*`)
	if err != nil || star != `..\*` {
		t.Fatalf("escaped star name: %q %v", star, err)
	}
	nested, err := SanitizeUserGlob(`sub/..\[id\]/page.tsx`)
	if err != nil || nested != `sub/..\[id\]/page.tsx` {
		t.Fatalf("nested escaped name: %q %v", nested, err)
	}
}

func TestFilterByGlobs(t *testing.T) {
	files := []string{"a.log", "b.log", "logs/c.log", "src/app.ts"}
	onlyA := FilterByGlobs(files, []string{"a.log"}, nil)
	if len(onlyA) != 1 || onlyA[0] != "a.log" {
		t.Fatalf("file pick: %v", onlyA)
	}
	logs := FilterByGlobs(files, []string{"logs/**"}, nil)
	if len(logs) != 1 || logs[0] != "logs/c.log" {
		t.Fatalf("dir glob: %v", logs)
	}
	star := FilterByGlobs(files, []string{"*.log"}, nil)
	if len(star) != 3 {
		t.Fatalf("*.log: %v", star)
	}
	excluded := FilterByGlobs(files, nil, []string{"b.log"})
	if len(excluded) != 3 {
		t.Fatalf("exclude: %v", excluded)
	}
	none := FilterByGlobs(files, []string{"missing.txt"}, nil)
	if len(none) != 0 {
		t.Fatalf("no match: %v", none)
	}
	src := FilterByGlobs(files, []string{"src/app.ts"}, nil)
	if len(src) != 1 || src[0] != "src/app.ts" {
		t.Fatalf("path glob: %v", src)
	}
	sameName := FilterByGlobs(
		[]string{"ok.txt", "dir/ok.txt"},
		[]string{"ok.txt"},
		nil,
	)
	if len(sameName) != 1 || sameName[0] != "ok.txt" {
		t.Fatalf("literal pick is exact: %v", sameName)
	}
	twoSame := FilterByGlobs(
		[]string{"a/page.tsx", "b/page.tsx", "c/page.tsx"},
		[]string{"a/page.tsx", "b/page.tsx"},
		nil,
	)
	if len(twoSame) != 2 || twoSame[0] != "a/page.tsx" || twoSame[1] != "b/page.tsx" {
		t.Fatalf("two same names: %v", twoSame)
	}
	bracketed := FilterByGlobs(
		[]string{"app/[id]/page.tsx", "pkg/[id]/page.tsx", "app/other/page.tsx"},
		[]string{`app/\[id\]/page.tsx`, `pkg/\[id\]/page.tsx`},
		nil,
	)
	if len(bracketed) != 2 || bracketed[0] != "app/[id]/page.tsx" || bracketed[1] != "pkg/[id]/page.tsx" {
		t.Fatalf("escaped bracket picks: %v", bracketed)
	}
	bracketDir := FilterByGlobs(
		[]string{"app/[id]/page.tsx", "app/[id]/nested/x.tsx", "pkg/[id]/page.tsx"},
		[]string{`app/\[id\]/**`},
		nil,
	)
	if len(bracketDir) != 2 || bracketDir[0] != "app/[id]/page.tsx" || bracketDir[1] != "app/[id]/nested/x.tsx" {
		t.Fatalf("escaped bracket dir: %v", bracketDir)
	}
	picked := FilterByGlobs(files, []string{"src/**"}, nil)
	and := FilterByGlobs(picked, []string{"*.ts"}, nil)
	if len(and) != 1 || and[0] != "src/app.ts" {
		t.Fatalf("include AND pick: %v", and)
	}
}

func TestToRgGlobAnchorsLiterals(t *testing.T) {
	if got := ToRgGlob("keep.log"); got != "/keep.log" {
		t.Fatalf("literal: %q", got)
	}
	if got := ToRgGlob("src/keep.ts"); got != "src/keep.ts" {
		t.Fatalf("path: %q", got)
	}
	if got := ToRgGlob("*.ts"); got != "*.ts" {
		t.Fatalf("wildcard: %q", got)
	}
	if got := ToRgGlob("src/**"); got != "src/**" {
		t.Fatalf("dir: %q", got)
	}
	if got := ToRgGlob("/already"); got != "/already" {
		t.Fatalf("anchored: %q", got)
	}
	if got := ToRgGlob(`\[id\].txt`); got != `/\[id\].txt` {
		t.Fatalf("escaped root literal: %q", got)
	}
	if got := ToRgGlob(`app/\[id\]/page.tsx`); got != `app/\[id\]/page.tsx` {
		t.Fatalf("escaped nested literal: %q", got)
	}
}

func TestDenylistRgGlobs(t *testing.T) {
	globs := DenylistRgGlobs(false, false)
	for _, g := range globs {
		if g[0] != '!' {
			t.Fatalf("expected negated, got %s", g)
		}
	}
	with := DenylistRgGlobs(false, true)
	if with[len(with)-1] != ".env.example" {
		t.Fatalf("last should be .env.example, got %s", with[len(with)-1])
	}
	if DenylistRgGlobs(true, false) != nil {
		t.Fatal("allowSecrets")
	}
}
