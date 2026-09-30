package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"web-grep/internal/auth"
	"web-grep/internal/config"
)

// text/plain is a CORS simple-request content type. Search and login must
// reject it (and any other non-JSON type) before a search slot is taken.

func TestSearchRejectsNonJSONContentType(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	h := s.Handler()
	for _, tc := range rejectedMediaTypes() {
		t.Run(tc.name, func(t *testing.T) {
			rec := postBody(t, h, "http://127.0.0.1:8787/api/search", `{"query":"alpha"}`, tc.ct, tc.omit)
			assertAPIError(t, rec, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
			if s.Search.Inflight() != 0 {
				t.Fatalf("rejected content type took a slot: %d", s.Search.Inflight())
			}
		})
	}
}

func TestSearchAcceptsJSONContentTypeWithParams(t *testing.T) {
	s, _ := testServer(t, fakeEngine{})
	h := s.Handler()
	for _, ct := range acceptedMediaTypes() {
		t.Run(ct, func(t *testing.T) {
			rec := postBody(t, h, "http://127.0.0.1:8787/api/search", `{"query":"alpha"}`, ct, false)
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
				t.Fatalf("content-type %q", got)
			}
			if !strings.Contains(rec.Body.String(), "event: meta") {
				t.Fatalf("missing stream: %s", rec.Body.String())
			}
			if s.Search.Inflight() != 0 {
				t.Fatalf("slot leaked: %d", s.Search.Inflight())
			}
		})
	}
}

func TestNonJSONSearchRejectedBeforePreflight(t *testing.T) {
	s, _ := testServer(t, nil)
	rec := postBody(t, s.Handler(), "http://127.0.0.1:8787/api/search", `{"query":"alpha"}`, "text/plain", false)
	assertAPIError(t, rec, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
	if s.Search.Inflight() != 0 {
		t.Fatalf("inflight %d", s.Search.Inflight())
	}
}

func TestRejectedContentTypeDoesNotTakeSearchSlot(t *testing.T) {
	const maxC = 2
	started := make(chan struct{}, maxC)
	release := make(chan struct{})
	var once sync.Once
	releaseOnce := func() { once.Do(func() { close(release) }) }
	t.Cleanup(releaseOnce)

	s, _ := testServer(t, blockingEngine{started: started, release: release})
	setMaxConcurrent(s, maxC)
	h := s.Handler()

	bad := postBody(t, h, "http://127.0.0.1:8787/api/search", `{"query":"alpha"}`, "text/plain", false)
	assertAPIError(t, bad, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
	if s.Search.Inflight() != 0 {
		t.Fatalf("reject took a slot: %d", s.Search.Inflight())
	}

	codes := make([]int, maxC)
	var wg sync.WaitGroup
	wg.Add(maxC)
	for i := 0; i < maxC; i++ {
		go func(i int) {
			defer wg.Done()
			rec := do(t, h, "POST", "http://127.0.0.1:8787/api/search", `{"query":"alpha"}`, nil)
			codes[i] = rec.Code
		}(i)
	}
	waitStarted(t, started, maxC)
	if s.Search.Inflight() != maxC {
		t.Fatalf("inflight=%d want %d", s.Search.Inflight(), maxC)
	}

	// Still before Preflight: a bad type is 400, not BUSY, and does not change the cap.
	again := postBody(t, h, "http://127.0.0.1:8787/api/search", `{"query":"alpha"}`, "multipart/form-data; boundary=----fx2", false)
	assertAPIError(t, again, http.StatusBadRequest, "INVALID_QUERY", "invalid request")
	if s.Search.Inflight() != maxC {
		t.Fatalf("bad content type changed inflight to %d", s.Search.Inflight())
	}

	releaseOnce()
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("full-cap search %d: %d", i, code)
		}
	}
	if s.Search.Inflight() != 0 {
		t.Fatalf("slots leaked: %d", s.Search.Inflight())
	}
}

func TestLoginRejectsNonJSONContentType(t *testing.T) {
	s, _ := testServer(t, nil)
	cfg := s.Config()
	cfg.TokenHash = config.HashPassword("secret1")
	s.SetConfig(cfg)
	s.Sessions = auth.NewSessions()
	h := s.Handler()

	for _, tc := range rejectedMediaTypes() {
		t.Run(tc.name, func(t *testing.T) {
			rec := postBody(t, h, "http://127.0.0.1:8787/api/auth/login", `{"password":"secret1"}`, tc.ct, tc.omit)
			assertAPIError(t, rec, http.StatusBadRequest, "INVALID_AUTH", "invalid request")
		})
	}

	badJSON := postBody(t, h, "http://127.0.0.1:8787/api/auth/login", `not-json`, "application/json", false)
	assertAPIError(t, badJSON, http.StatusBadRequest, "INVALID_AUTH", "invalid request")

	for _, ct := range acceptedMediaTypes() {
		t.Run("accept "+ct, func(t *testing.T) {
			rec := postBody(t, h, "http://127.0.0.1:8787/api/auth/login", `{"password":"secret1"}`, ct, false)
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["token"] == "" {
				t.Fatalf("missing token: %s", rec.Body.String())
			}
		})
	}
}

type mediaCase struct {
	name string
	ct   string
	omit bool
}

func rejectedMediaTypes() []mediaCase {
	return []mediaCase{
		{name: "missing", omit: true},
		{name: "text/plain", ct: "text/plain"},
		{name: "text/plain charset", ct: "text/plain; charset=utf-8"},
		{name: "form", ct: "application/x-www-form-urlencoded"},
		{name: "multipart form", ct: "multipart/form-data; boundary=----fx2"},
		{name: "multipart mixed", ct: "multipart/mixed; boundary=----fx2"},
	}
}

func acceptedMediaTypes() []string {
	return []string{
		"application/json",
		"application/json; charset=UTF-8",
		"application/json;charset=utf-8",
		"Application/JSON; Charset=UTF-8",
	}
}

func postBody(t *testing.T, h http.Handler, url, body, contentType string, omitType bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Host = "127.0.0.1:8787"
	if !omitType {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func assertAPIError(t *testing.T, rec *httptest.ResponseRecorder, status int, code, message string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type %q body %s", got, rec.Body.String())
	}
	if strings.Contains(rec.Header().Get("Content-Type"), "text/event-stream") || strings.Contains(rec.Body.String(), "event:") {
		t.Fatalf("opened a stream: %s", rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %s: %v", rec.Body.String(), err)
	}
	if body["code"] != code || body["message"] != message {
		t.Fatalf("body %+v", body)
	}
}
