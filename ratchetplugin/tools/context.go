package tools

import "context"

// Context key types for workspace and container injection.
type contextKey int

const (
	// ContextKeyWorkspacePath overrides tool workspace paths.
	ContextKeyWorkspacePath contextKey = iota
	// ContextKeyContainerID signals a container exec context for shell_exec.
	ContextKeyContainerID
	// ContextKeyProjectID carries the current project ID.
	ContextKeyProjectID
)

// WorkspacePathFromContext returns the workspace path from context, if set.
func WorkspacePathFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ContextKeyWorkspacePath).(string)
	return v, ok && v != ""
}

// ContainerIDFromContext returns the active container ID from context, if set.
func ContainerIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ContextKeyContainerID).(string)
	return v, ok && v != ""
}

// ProjectIDFromContext returns the project ID from context, if set.
func ProjectIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ContextKeyProjectID).(string)
	return v, ok && v != ""
}

// WithWorkspacePath returns a context with the workspace path set.
func WithWorkspacePath(ctx context.Context, path string) context.Context {
	return context.WithValue(ctx, ContextKeyWorkspacePath, path)
}

// WithContainerID returns a context with the container ID set.
func WithContainerID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ContextKeyContainerID, id)
}

// WithProjectID returns a context with the project ID set.
func WithProjectID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ContextKeyProjectID, id)
}
