package auth

import "testing"

func TestIssuePersistsUntilRevoked(t *testing.T) {
	s := NewSessions()
	token, err := s.Issue()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("empty token")
	}
	if !s.Lookup(token) {
		t.Fatal("fresh session missing")
	}
	s.Revoke(token)
	if s.Lookup(token) {
		t.Fatal("revoked session still valid")
	}
}
