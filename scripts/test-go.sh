#!/usr/bin/env bash
# Usage: test-go.sh [unit|integration|e2e|coverage]
set -euo pipefail

cd "$(dirname "$0")/../services/price-service"

source_env() {
  set -o allexport
  [ -f .env.development ] && . .env.development || true
  [ -f .env.test ] && . .env.test || true
  set +o allexport
}

source_env

case "${1:-unit}" in
  unit)
    packages=$(go list ./... | grep -v "/tests/integration" | grep -v "/tests/e2e")
    go test $packages
    ;;
  integration|int)
    go test ./tests/integration/...
    ;;
  e2e)
    mise run e2e
    ;;
  coverage)
    go test -cover ./...
    ;;
  *)
    go test ./tests/unit/...
    ;;
esac
