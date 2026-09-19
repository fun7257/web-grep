package httpapi

import (
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func spa(dir string, publicPath func() string) http.Handler {
	root := os.DirFS(dir)
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" || name == "index.html" {
			serveIndex(w, dir, publicPath())
			return
		}
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if _, err := fs.Stat(root, name); err != nil {
			serveIndex(w, dir, publicPath())
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

const publicPathMarker = "__WEB_GREP_BASE__"

func serveIndex(w http.ResponseWriter, dir, publicPath string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	raw, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil {
		http.Error(w, "index missing", http.StatusInternalServerError)
		return
	}
	inject := "/"
	if publicPath != "" {
		inject = publicPath + "/"
	}
	body := strings.ReplaceAll(string(raw), publicPathMarker, inject)
	_, _ = io.WriteString(w, body)
}
