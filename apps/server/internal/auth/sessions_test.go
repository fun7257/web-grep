package auth

import (
	"testing"
	"time"
)

func TestIssueExpiresInSevenDays(t *testing.T) {
	s := NewSessions()
	token, exp, err := s.Issue()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("empty token")
	}
	if !s.Lookup(token) {
		t.Fatal("fresh session missing")
	}
	until := time.Until(exp)
	if until < 6*24*time.Hour || until > 8*24*time.Hour {
		t.Fatalf("ttl want ~7d, got %s", until)
	}
}

func TestLookupRejectsExpired(t *testing.T) {
	s := NewSessions()
	token, _, err := s.Issue()
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	sess := s.m[token]
	sess.Exp = time.Now().Add(-time.Second)
	s.m[token] = sess
	s.mu.Unlock()
	if s.Lookup(token) {
		t.Fatal("expired session still valid")
	}
}
