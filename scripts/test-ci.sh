#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  echo ""
  echo "Cleaning up test services..."
  docker compose --profile test down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "=========================================="
echo "CI Test Runner - isolated docker run"
echo "=========================================="

# Always start from a clean test environment in CI mode.
docker compose --profile test down -v 2>/dev/null || true

./scripts/test-all.sh
