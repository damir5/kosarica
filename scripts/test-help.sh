#!/usr/bin/env bash
cat << 'EOF'
Test Commands (mise run test-*)
================================
Node.js Tests:
  test-node          All Node tests (vitest)
  test-node-unit     Unit tests only (no services needed)
  test-node-int      Integration tests

Go Tests:
  test-go            Go unit tests
  test-go-int        Go integration tests
  test-go-e2e        Go e2e tests (starts containers)
  test-go-coverage   Tests with coverage report

Combined:
  test-all           Full suite (builds Go, migrates, runs everything)
  test               Show this help

Dependencies:
  test-node-unit, test-go       → No external services
  test-node, test-node-int      → Database only
  test-go-e2e, test-all         → Database + Docker
EOF
