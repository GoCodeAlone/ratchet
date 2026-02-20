package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// jwtHeader is the fixed base64-encoded JWT header for HS256.
var jwtHeader = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

// jwtClaims holds the JWT payload fields.
type jwtClaims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
	Iat int64  `json:"iat"`
}

// signJWT creates a JWT token with HS256 using the given secret.
func signJWT(secret string, claims jwtClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshal claims: %w", err)
	}
	enc := jwtHeader + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(enc)) //nolint:errcheck
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return enc + "." + sig, nil
}

// verifyJWT validates a JWT and returns the subject claim.
func verifyJWT(secret, token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("malformed token")
	}
	// Verify signature
	enc := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(enc)) //nolint:errcheck
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return "", fmt.Errorf("invalid signature")
	}

	// Decode payload
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode payload: %w", err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return "", fmt.Errorf("parse claims: %w", err)
	}

	// Check expiry
	if time.Now().Unix() > claims.Exp {
		return "", fmt.Errorf("token expired")
	}
	return claims.Sub, nil
}

// generateSecret creates a random 32-byte hex secret.
func generateSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// jwtSecret returns the configured JWT secret, generating one if empty.
func (s *Server) jwtSecret() string {
	if s.cfg.Auth.JWTSecret != "" {
		return s.cfg.Auth.JWTSecret
	}
	s.secretOnce.Do(func() {
		s.generatedSecret = generateSecret()
	})
	return s.generatedSecret
}

// loginRequest is the body accepted by POST /api/auth/login.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// loginResponse is the body returned by a successful login.
type loginResponse struct {
	Token string `json:"token"`
}

// handleLogin validates credentials and issues a JWT.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username != s.cfg.Auth.AdminUser || req.Password != s.cfg.Auth.AdminPass {
		writeJSONError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	now := time.Now()
	claims := jwtClaims{
		Sub: req.Username,
		Iat: now.Unix(),
		Exp: now.Add(24 * time.Hour).Unix(),
	}
	token, err := signJWT(s.jwtSecret(), claims)
	if err != nil {
		s.logger.Error("sign jwt", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "could not issue token")
		return
	}

	writeJSON(w, http.StatusOK, loginResponse{Token: token})
}

// handleMe returns the currently authenticated user.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	subject := r.Context().Value(ctxKeySubject)
	writeJSON(w, http.StatusOK, map[string]string{"username": fmt.Sprint(subject)})
}

// authMiddleware enforces JWT authentication on wrapped handlers.
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeJSONError(w, http.StatusUnauthorized, "missing or invalid Authorization header")
			return
		}
		token := strings.TrimPrefix(authHeader, "Bearer ")
		subject, err := verifyJWT(s.jwtSecret(), token)
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "invalid token: "+err.Error())
			return
		}
		ctx := contextWithSubject(r.Context(), subject)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
