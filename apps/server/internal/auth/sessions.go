package auth

import (
	"crypto/rand"
	"sync"
)

type Sessions struct {
	mu sync.Mutex
	m  map[string]struct{}
}

func NewSessions() *Sessions {
	return &Sessions{m: make(map[string]struct{})}
}

func (s *Sessions) Issue() (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[token] = struct{}{}
	return token, nil
}

func (s *Sessions) Lookup(token string) bool {
	if token == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.m[token]
	return ok
}

func (s *Sessions) Revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, token)
}

func randomToken() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	const hexdigits = "0123456789abcdef"
	out := make([]byte, 64)
	for i, b := range buf {
		out[i*2] = hexdigits[b>>4]
		out[i*2+1] = hexdigits[b&0x0f]
	}
	return string(out), nil
}
