package httpapi

import (
	"encoding/json"
	"mime"
	"net/http"
	"strings"
)

func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}

// jsonContentType is true only for application/json. Parameters such as
// charset are ignored and the type match is case-insensitive. text/plain is
// a CORS simple-request content type, so a missing or non-JSON type is
// rejected before the body is treated as JSON.
func jsonContentType(r *http.Request) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		return false
	}
	return strings.EqualFold(media, "application/json")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
