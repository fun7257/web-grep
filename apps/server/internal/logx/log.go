package logx

import (
	"encoding/json"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

var (
	mu    sync.Mutex
	out   io.Writer = os.Stdout
	level           = LevelInfo
)

func SetLevel(name string) {
	lv := LevelInfo
	switch name {
	case "debug":
		lv = LevelDebug
	case "warn":
		lv = LevelWarn
	case "error":
		lv = LevelError
	}
	mu.Lock()
	level = lv
	mu.Unlock()
}

// DebugEnabled reports whether a debug line would be written.
// Callers use it to skip building expensive messages.
func DebugEnabled() bool {
	mu.Lock()
	defer mu.Unlock()
	return level == LevelDebug
}

// headLineMax is the longest first line kept on warn and error.
// Later lines of an rg failure repeat the pattern, so they stay at debug.
const headLineMax = 200

// ClipForLog returns the first line of text and how many lines it has.
// The line is cut to headLineMax Unicode code points so a character is not
// split. When root is set and label is a different string, root is replaced
// on that first line so an absolute search root stays out of warn and error.
// Later lines are dropped; log the original text at debug when it is still needed.
func ClipForLog(text, root, label string) (string, int) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = strings.TrimRight(text, "\n")
	if text == "" {
		return "", 0
	}
	parts := strings.Split(text, "\n")
	head := parts[0]
	if root != "" && label != "" && root != label {
		head = strings.ReplaceAll(head, root, label)
	}
	if runes := []rune(head); len(runes) > headLineMax {
		head = string(runes[:headLineMax])
	}
	return head, len(parts)
}

// SetOutput directs log lines to w. A nil writer restores stdout.
// Tests capture lines with a buffer; the server leaves the default.
func SetOutput(w io.Writer) {
	if w == nil {
		w = os.Stdout
	}
	mu.Lock()
	out = w
	mu.Unlock()
}

func logAt(lv Level, name, msg string, fields map[string]any) {
	mu.Lock()
	enabled := lv >= level
	mu.Unlock()
	if !enabled {
		return
	}
	rec := map[string]any{
		"ts":    time.Now().UTC().Format(time.RFC3339Nano),
		"level": name,
		"msg":   msg,
	}
	for k, v := range fields {
		rec[k] = v
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	_, _ = out.Write(append(b, '\n'))
}

func Debug(msg string, fields map[string]any) { logAt(LevelDebug, "debug", msg, fields) }
func Info(msg string, fields map[string]any)  { logAt(LevelInfo, "info", msg, fields) }
func Warn(msg string, fields map[string]any)  { logAt(LevelWarn, "warn", msg, fields) }
func Error(msg string, fields map[string]any) { logAt(LevelError, "error", msg, fields) }
