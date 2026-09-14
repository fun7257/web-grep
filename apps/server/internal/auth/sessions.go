package auth

import (
	"crypto/rand"
	"sync"
	"time"
)

const SessionTTL = 7 * 24 * time.Hour

type session struct {
	Exp time.Time
}

type Sessions struct {
	mu sync.Mutex
	m  map[string]session
}

func NewSessions() *Sessions {
	return &Sessions{m: make(map[string]session)}
}

func (s *Sessions) Issue() (string, time.Time, error) {
	token, err := randomToken()
	if err != nil {
		return "", time.Time{}, err
	}
	exp := time.Now().Add(SessionTTL)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[token] = session{Exp: exp}
	return token, exp, nil
}

func (s *Sessions) Lookup(token string) bool {
	if token == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.m[token]
	if !ok {
		return false
	}
	if time.Now().After(sess.Exp) {
		delete(s.m, token)
		return false
	}
	return true
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
