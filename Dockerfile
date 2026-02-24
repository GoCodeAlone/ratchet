# Multi-stage build for the Ratchet agent orchestration server.
#
# Build:   docker build --build-arg NPM_TOKEN=$(gh auth token) -t ratchet .
# Run:     docker run -p 9090:9090 -v $(pwd)/data:/app/data ratchet
#
# NPM_TOKEN is required for @gocodealone scoped packages from GitHub Packages.

# --- Stage 1: Build the React UI ---
# Use BUILDPLATFORM so npm ci runs natively (UI assets are platform-independent).
FROM --platform=$BUILDPLATFORM node:22-alpine AS ui-builder

ARG NPM_TOKEN
WORKDIR /build/ui

COPY ui/package.json ui/package-lock.json ui/.npmrc ./
# Copy pre-built workflow-ui tarball (built from GoCodeAlone/workflow-ui)
COPY ui/gocodealone-workflow-ui-*.tgz ./
RUN --mount=type=secret,id=npm_token \
    if [ -f /run/secrets/npm_token ]; then \
      echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc; \
    elif [ -n "$NPM_TOKEN" ]; then \
      echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc; \
    fi && \
    npm install --save gocodealone-workflow-ui-*.tgz 2>/dev/null || true && \
    npm install --silent && \
    sed -i '/^\/\/npm.pkg.github.com\/:_authToken/d' .npmrc 2>/dev/null || true

COPY ui/ .
RUN npx vite build

# --- Stage 2: Build the Go binary ---
# Use BUILDPLATFORM so go mod download runs natively; cross-compile via TARGETOS/TARGETARCH.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS go-builder

ARG TARGETOS TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown

# GoCodeAlone modules are private; bypass proxy/sumdb.
ENV GOPRIVATE=github.com/GoCodeAlone/* \
    GONOSUMCHECK=github.com/GoCodeAlone/*

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# Cache dependency downloads
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Cross-compile for the target platform (no QEMU needed)
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags="-s -w \
      -X github.com/GoCodeAlone/ratchet/internal/version.Version=${VERSION} \
      -X github.com/GoCodeAlone/ratchet/internal/version.Commit=${COMMIT} \
      -X github.com/GoCodeAlone/ratchet/internal/version.BuildDate=${BUILD_DATE}" \
    -o ratchetd ./cmd/ratchetd

# --- Stage 3: Runtime ---
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 65532 nonroot

WORKDIR /app

COPY --from=go-builder /build/ratchetd .
COPY --from=ui-builder /build/ui/dist/ ./ui/dist/
COPY ratchet.yaml .

# Create writable data directory for SQLite (data/ratchet.db)
RUN mkdir -p /app/data && chown nonroot:nonroot /app/data

USER nonroot

EXPOSE 9090

ENTRYPOINT ["./ratchetd"]
CMD ["--config", "ratchet.yaml"]
