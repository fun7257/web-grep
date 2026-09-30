package logx

import (
	"strings"
	"testing"
)

func TestClipForLog(t *testing.T) {
	long := strings.Repeat("字", 201)
	root := "/var/lib/secret-root"
	cases := []struct {
		name      string
		text      string
		root      string
		label     string
		wantHead  string
		wantLines int
	}{
		{name: "empty", wantHead: "", wantLines: 0},
		{name: "one line", text: "rg: boom", wantHead: "rg: boom", wantLines: 1},
		{name: "trailing newline", text: "rg: boom\n", wantHead: "rg: boom", wantLines: 1},
		{name: "crlf", text: "rg: boom\r\n    pat\r\n", wantHead: "rg: boom", wantLines: 2},
		{
			name:      "drops later lines",
			text:      "rg: regex parse error:\n    fx7-leak-query\nerror: unclosed group\n",
			wantHead:  "rg: regex parse error:",
			wantLines: 3,
		},
		{
			name:      "keeps 200 runes",
			text:      strings.Repeat("字", 200),
			wantHead:  strings.Repeat("字", 200),
			wantLines: 1,
		},
		{
			name:      "truncates runes",
			text:      long + "\nfx7-leak-query",
			wantHead:  strings.Repeat("字", 200),
			wantLines: 2,
		},
		{
			name:      "strips root",
			text:      "open " + root + "/a: boom\nfx7-leak-query",
			root:      root,
			label:     "secret-root",
			wantHead:  "open secret-root/a: boom",
			wantLines: 2,
		},
		{name: "blank lines count", text: "a\n\nb", wantHead: "a", wantLines: 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			head, lines := ClipForLog(tc.text, tc.root, tc.label)
			if head != tc.wantHead || lines != tc.wantLines {
				t.Fatalf("ClipForLog() = %q, %d; want %q, %d", head, lines, tc.wantHead, tc.wantLines)
			}
			if strings.Contains(head, "fx7-leak-query") {
				t.Fatalf("summary contains the query: %q", head)
			}
			if tc.root != "" && strings.Contains(head, tc.root) {
				t.Fatalf("summary contains the root: %q", head)
			}
		})
	}
}

func TestDebugEnabledFollowsLevel(t *testing.T) {
	t.Cleanup(func() { SetLevel("info") })
	SetLevel("info")
	if DebugEnabled() {
		t.Fatal("info should not enable debug")
	}
	SetLevel("warn")
	if DebugEnabled() {
		t.Fatal("warn should not enable debug")
	}
	SetLevel("error")
	if DebugEnabled() {
		t.Fatal("error should not enable debug")
	}
	SetLevel("debug")
	if !DebugEnabled() {
		t.Fatal("debug should enable debug")
	}
	SetLevel("nope")
	if DebugEnabled() {
		t.Fatal("unknown level defaults to info")
	}
}
