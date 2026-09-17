package utf8cut

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestStringKeepsRuneBoundary(t *testing.T) {
	s := strings.Repeat("你", 10)
	got := String(s, 10)
	if !utf8.ValidString(got) {
		t.Fatalf("invalid utf8: %q", got)
	}
	if got != strings.Repeat("你", 3) {
		t.Fatalf("got %q", got)
	}
}

func TestStringShortIsUnchanged(t *testing.T) {
	if String("hello", 100) != "hello" {
		t.Fatal("short")
	}
}
