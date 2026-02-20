package ratchetplugin

import (
	"context"
	"strings"
	"sync"

	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/workflow/secrets"
)

// SecretGuard scans text for known secret values and redacts them.
type SecretGuard struct {
	mu          sync.RWMutex
	knownValues map[string]string // value → name (reversed for fast lookup)
	provider    secrets.Provider
}

func NewSecretGuard(p secrets.Provider) *SecretGuard {
	return &SecretGuard{
		knownValues: make(map[string]string),
		provider:    p,
	}
}

// LoadSecrets loads secret values from the provider for the given keys.
func (sg *SecretGuard) LoadSecrets(ctx context.Context, names []string) error {
	sg.mu.Lock()
	defer sg.mu.Unlock()
	for _, name := range names {
		val, err := sg.provider.Get(ctx, name)
		if err != nil {
			continue // skip secrets that don't exist
		}
		if val != "" {
			sg.knownValues[val] = name
		}
	}
	return nil
}

// LoadAllSecrets loads all available secrets from the provider.
func (sg *SecretGuard) LoadAllSecrets(ctx context.Context) error {
	if sg.provider == nil {
		return nil
	}
	names, err := sg.provider.List(ctx)
	if err != nil {
		return err
	}
	return sg.LoadSecrets(ctx, names)
}

// Redact replaces known secret values with [REDACTED:name].
func (sg *SecretGuard) Redact(text string) string {
	sg.mu.RLock()
	defer sg.mu.RUnlock()
	for val, name := range sg.knownValues {
		if strings.Contains(text, val) {
			text = strings.ReplaceAll(text, val, "[REDACTED:"+name+"]")
		}
	}
	return text
}

// CheckAndRedact redacts secret values in a message. Returns true if redaction occurred.
func (sg *SecretGuard) CheckAndRedact(msg *provider.Message) bool {
	original := msg.Content
	msg.Content = sg.Redact(msg.Content)
	return msg.Content != original
}
