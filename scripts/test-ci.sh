#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "CI Test Runner - isolated docker run"
echo "=========================================="

# Always start from a clean test environment in CI mode.
docker compose --profile test down -v 2>/dev/null || true

./scripts/test-all.sh
