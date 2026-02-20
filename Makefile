VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS  = -X github.com/GoCodeAlone/ratchet/internal/version.Version=$(VERSION) \
           -X github.com/GoCodeAlone/ratchet/internal/version.Commit=$(COMMIT) \
           -X github.com/GoCodeAlone/ratchet/internal/version.BuildDate=$(DATE)

.PHONY: all build build-cli build-server test lint clean dev

all: build

build: build-cli build-server

build-cli:
	go build -ldflags "$(LDFLAGS)" -o bin/ratchet ./cmd/ratchet

build-server:
	go build -ldflags "$(LDFLAGS)" -o bin/ratchetd ./cmd/ratchetd

test:
	go test -race ./...

lint:
	go fmt ./...
	golangci-lint run

clean:
	rm -rf bin/ data/

dev: build-server
	./bin/ratchetd --config ratchet.yaml
