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

func TestRevokeOneSessionLeavesOthersValid(t *testing.T) {
	s := NewSessions()
	a, err := s.Issue()
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Issue()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("tokens must be unique")
	}
	s.Revoke(a)
	if s.Lookup(a) {
		t.Fatal("kicked session still valid")
	}
	if !s.Lookup(b) {
		t.Fatal("revoke must not invalidate other sessions")
	}
	s.Revoke(b)
	if s.Lookup(b) {
		t.Fatal("second revoke left session valid")
	}
}
