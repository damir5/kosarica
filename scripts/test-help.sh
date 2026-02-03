#!/usr/bin/env bash
cat << 'EOH'
Test Commands (mise run test-*)
================================
Node.js Tests:
  test-node          All Node tests (vitest)
  test-node-unit     Unit tests only (no services needed)

Combined:
  test-all           Full suite (migrate DB, run JS tests)
  test               Show this help

Dependencies:
  test-node-unit     → No external services
  test-node          → Database + ClickHouse
  test-all           → Database + ClickHouse
EOH
