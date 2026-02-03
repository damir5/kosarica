#!/usr/bin/env bash
# Usage: test-node.sh [all|unit|integration]
set -euo pipefail

case "${1:-all}" in
  unit)
    pnpm test:unit
    ;;
  integration|int)
    pnpm test:integration
    ;;
  all|*)
    pnpm test
    ;;
esac
