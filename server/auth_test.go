package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/GoCodeAlone/ratchet/config"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.Config{
		Server: config.ServerConfig{Addr: ":0"},
		Auth: config.AuthConfig{
			AdminUser: "admin",
			AdminPass: "secret",
			JWTSecret: "test-secret-key-1234567890",
		},
	}
	return New(cfg, "test", nil)
}

func TestSignAndVerifyJWT(t *testing.T) {
	secret := "my-test-secret"
	claims := jwtClaims{
		Sub: "alice",
		Iat: time.Now().Unix(),
		Exp: time.Now().Add(time.Hour).Unix(),
	}
	token, err := signJWT(secret, claims)
	if err != nil {
		t.Fatalf("signJWT: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	subject, err := verifyJWT(secret, token)
	if err != nil {
		t.Fatalf("verifyJWT: %v", err)
	}
	if subject != "alice" {
		t.Errorf("expected subject 'alice', got %q", subject)
	}
}

func TestVerifyJWT_ExpiredToken(t *testing.T) {
	secret := "my-test-secret"
	claims := jwtClaims{
		Sub: "alice",
		Iat: time.Now().Add(-2 * time.Hour).Unix(),
		Exp: time.Now().Add(-time.Hour).Unix(), // already expired
	}
	token, err := signJWT(secret, claims)
	if err != nil {
		t.Fatalf("signJWT: %v", err)
	}

	_, err = verifyJWT(secret, token)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestVerifyJWT_BadSignature(t *testing.T) {
	claims := jwtClaims{
		Sub: "alice",
		Iat: time.Now().Unix(),
		Exp: time.Now().Add(time.Hour).Unix(),
	}
	token, _ := signJWT("correct-secret", claims)
	_, err := verifyJWT("wrong-secret", token)
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestHandleLogin_Success(t *testing.T) {
	s := newTestServer(t)
	s.registerRoutes()

	body := `{"username":"admin","password":"secret"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["token"] == "" {
		t.Error("expected non-empty token in response")
	}
}

func TestHandleLogin_WrongPassword(t *testing.T) {
	s := newTestServer(t)
	s.registerRoutes()

	body := `{"username":"admin","password":"wrong"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuthMiddleware_MissingToken(t *testing.T) {
	s := newTestServer(t)
	s.registerRoutes()

	req := httptest.NewRequest(http.MethodGet, "/api/agents", nil)
	rr := httptest.NewRecorder()

	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	s := newTestServer(t)

	// Create a no-op agent manager and task store for handlers
	s.SetAgentManager(&noopAgentManager{})
	s.SetTaskStore(&noopTaskStore{})
	s.SetBus(&noopBus{})
	s.registerRoutes()

	// Get a token first
	loginBody := `{"username":"admin","password":"secret"}`
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(loginBody))
	loginRR := httptest.NewRecorder()
	s.mux.ServeHTTP(loginRR, loginReq)
	if loginRR.Code != http.StatusOK {
		t.Fatalf("login failed: %d", loginRR.Code)
	}
	var loginResp map[string]string
	json.NewDecoder(loginRR.Body).Decode(&loginResp) //nolint:errcheck
	token := loginResp["token"]

	// Use token to access protected endpoint
	req := httptest.NewRequest(http.MethodGet, "/api/agents", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}
