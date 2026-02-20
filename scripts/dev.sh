#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "Building ratchet..."
cd "$ROOT"
go build -o bin/ratchetd ./cmd/ratchetd

echo "Starting ratchet server..."
exec ./bin/ratchetd --config ratchet.yaml "$@"
