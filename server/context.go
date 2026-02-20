package server

import "context"

type contextKey int

const ctxKeySubject contextKey = 0

func contextWithSubject(ctx context.Context, subject string) context.Context {
	return context.WithValue(ctx, ctxKeySubject, subject)
}
