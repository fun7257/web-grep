package logx

import (
	"encoding/json"
	"io"
	"os"
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
	switch name {
	case "debug":
		level = LevelDebug
	case "warn":
		level = LevelWarn
	case "error":
		level = LevelError
	default:
		level = LevelInfo
	}
}

func logAt(lv Level, name, msg string, fields map[string]any) {
	if lv < level {
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
