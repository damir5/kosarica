#!/usr/bin/env bash
cat << 'EOH'
Test Commands (mise run test-*)
================================
Node.js Tests:
  test-node          All Node tests (vitest)
  test-node-unit     Unit tests only (no services needed)

Combined:
  test-all           Full suite (migrate DB, run JS tests)
  test-ci            CI mode (auto-starts services, runs tests, cleans up)
  test               Show this help

Service Management:
  services-up        Start dev services (Postgres + ClickHouse)
  services-down      Stop dev services
  services-status    Show dev services status
  services-logs      Follow dev services logs
  services-reset     Reset dev services (fresh data)

ClickHouse:
  clickhouse-status        Check sync status
  clickhouse-load-missing  Incremental sync
  clickhouse-load-all      Full rebuild

Dependencies:
  test-node-unit     → No external services
  test-node          → Database + ClickHouse
  test-all           → Database + ClickHouse
  test-ci            → None (manages its own containers)

OrbStack DNS:
  Dev containers:    ade-postgres.orb.local, ade-clickhouse.orb.local
  Test containers:   ade-postgres-test.orb.local, ade-clickhouse-test.orb.local
EOH
