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
