#!/usr/bin/env bash
# Usage: test-node.sh [all|unit|integration|price-service]
set -euo pipefail

case "${1:-all}" in
  unit)
    pnpm test:unit
    ;;
  integration|int)
    pnpm test:integration
    ;;
  price-service|ps)
    pnpm test:price-service
    ;;
  all|*)
    pnpm test
    ;;
esac
