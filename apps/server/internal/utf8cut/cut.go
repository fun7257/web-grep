package utf8cut

import (
	"strings"
	"unicode/utf8"
)

// String truncates s to at most maxBytes without splitting a UTF-8 rune.
func String(s string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(s) <= maxBytes {
		if utf8.ValidString(s) {
			return s
		}
		return strings.ToValidUTF8(s, "\uFFFD")
	}
	end := maxBytes
	for end > 0 && !utf8.RuneStart(s[end]) {
		end--
	}
	s = s[:end]
	if utf8.ValidString(s) {
		return s
	}
	return strings.ToValidUTF8(s, "\uFFFD")
}
