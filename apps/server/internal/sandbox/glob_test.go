package sandbox

import "testing"

func TestCompileHitFilterIntersection(t *testing.T) {
	ok := CompileHitFilter([]string{"src/**"}, []string{"*.test.ts"}, []string{"*.ts"})
	if !ok("src/a.ts") {
		t.Fatal("src/a.ts should pass include∩and")
	}
	if ok("src/b.js") {
		t.Fatal("js should fail and")
	}
	if ok("other.ts") {
		t.Fatal("outside src should fail include")
	}
	if ok("src/a.test.ts") {
		t.Fatal("exclude should drop tests")
	}
}

func TestCompileHitFilterEmptyPasses(t *testing.T) {
	ok := CompileHitFilter(nil, nil, nil)
	if !ok("anything") {
		t.Fatal("no globs should pass")
	}
}
