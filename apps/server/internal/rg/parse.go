package rg

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"web-grep/internal/config"
	"web-grep/internal/sandbox"
	"web-grep/internal/utf8cut"
)

var (
	matchTypePrefix = []byte(`{"type":"match"`)
	beginTypePrefix = []byte(`{"type":"begin"`)
)

func IsBeginLine(line []byte) bool {
	return bytes.HasPrefix(line, beginTypePrefix)
}

type Match struct {
	Path       string
	Line       int
	Text       string
	Submatches [][2]int
}

type Hit struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Text    string `json:"text"`
	Matches []Span `json:"matches"`
}

type Span struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

func ParseMatchLine(line []byte) (Match, bool) {
	m, _, ok := parseMatchRecord(line)
	return m, ok
}

// parseMatchRecord parses one rg JSON match line. The payload is the raw
// line bytes to feed a filter (exactly one trailing '\n'; a CRLF '\r' is
// kept). payload is nil when the line is a match but its bytes cannot be
// recovered; ParseMatchLine still succeeds in that case.
func parseMatchRecord(line []byte) (Match, []byte, bool) {
	if !bytes.HasPrefix(line, matchTypePrefix) {
		return Match{}, nil, false
	}
	var raw struct {
		Type string `json:"type"`
		Data struct {
			Path struct {
				Text string `json:"text"`
			} `json:"path"`
			Lines struct {
				Text  string `json:"text"`
				Bytes string `json:"bytes"`
			} `json:"lines"`
			LineNumber int `json:"line_number"`
			Submatches []struct {
				Start int `json:"start"`
				End   int `json:"end"`
			} `json:"submatches"`
		} `json:"data"`
	}
	if err := json.Unmarshal(line, &raw); err != nil {
		return Match{}, nil, false
	}
	if raw.Type != "match" || raw.Data.Path.Text == "" || raw.Data.LineNumber < 1 {
		return Match{}, nil, false
	}
	m := Match{
		Path: raw.Data.Path.Text,
		Line: raw.Data.LineNumber,
		Text: decodeRgLine(raw.Data.Lines.Text, raw.Data.Lines.Bytes),
	}
	for _, s := range raw.Data.Submatches {
		m.Submatches = append(m.Submatches, [2]int{s.Start, s.End})
	}
	payload, ok := filterLinePayload(raw.Data.Lines.Text, raw.Data.Lines.Bytes)
	if !ok {
		return m, nil, true
	}
	return m, payload, true
}

// filterLinePayload is the raw matched line. lines.text wins when rg sent
// UTF-8; otherwise lines.bytes is standard base64. The result ends with
// exactly one '\n' so a final line that had no newline still counts as one
// filter input line. A preceding '\r' is preserved.
func filterLinePayload(text, b64 string) ([]byte, bool) {
	var raw []byte
	switch {
	case text != "":
		raw = []byte(text)
	case b64 != "":
		decoded, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, false
		}
		raw = decoded
	}
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		out := make([]byte, len(raw)+1)
		copy(out, raw)
		out[len(raw)] = '\n'
		return out, true
	}
	return raw, true
}

func normalizeRgPath(rootReal, p string) (string, bool) {
	p = strings.TrimPrefix(p, "./")
	if p == "" || containsNUL(p) {
		return "", false
	}
	if filepath.IsAbs(p) {
		rel, err := filepath.Rel(rootReal, p)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", false
		}
		if rel == "." {
			return "", false
		}
		return rel, true
	}
	return p, true
}

func ToRelativeHit(rootReal string, allowSecrets bool, m Match) (Hit, bool) {
	rel, ok := normalizeRgPath(rootReal, m.Path)
	if !ok {
		return Hit{}, false
	}
	rel, err := sandbox.RelUnderRoot(rootReal, rel)
	if err != nil {
		return Hit{}, false
	}
	if sandbox.IsDenied(rel, allowSecrets) {
		return Hit{}, false
	}
	text := utf8cut.String(stripLineEnd(m.Text), config.LineTextMaxChars)
	limit := utf16Len(text)
	var spans []Span
	for _, sm := range m.Submatches {
		start := utf8ByteOffsetToUTF16(m.Text, sm[0])
		end := utf8ByteOffsetToUTF16(m.Text, sm[1])
		if start < 0 || end < 0 || start > end {
			continue
		}
		if start > limit {
			continue
		}
		if end > limit {
			end = limit
		}
		if start == end {
			continue
		}
		spans = append(spans, Span{Start: start, End: end})
	}
	if spans == nil {
		spans = []Span{}
	}
	return Hit{Path: rel, Line: m.Line, Text: text, Matches: spans}, true
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r <= 0xFFFF {
			n++
		} else {
			n += 2
		}
	}
	return n
}

func utf8ByteOffsetToUTF16(s string, byteOff int) int {
	if byteOff < 0 || byteOff > len(s) {
		return -1
	}
	if byteOff == 0 {
		return 0
	}
	prefix := s[:byteOff]
	if !utf8.ValidString(prefix) {
		return -1
	}
	return utf16Len(prefix)
}

func decodeRgLine(text, b64 string) string {
	if text != "" {
		return text
	}
	if b64 == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return ""
	}
	return strings.ToValidUTF8(string(raw), "\uFFFD")
}

func stripLineEnd(text string) string {
	switch {
	case len(text) >= 2 && text[len(text)-2:] == "\r\n":
		return text[:len(text)-2]
	case len(text) >= 1 && (text[len(text)-1] == '\n' || text[len(text)-1] == '\r'):
		return text[:len(text)-1]
	default:
		return text
	}
}

func containsNUL(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == 0 {
			return true
		}
	}
	return false
}
