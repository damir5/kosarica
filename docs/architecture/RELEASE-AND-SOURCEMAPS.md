# Release, Sourcemaps, and Blue/Green Runbook

## Goals

- Keep release metadata consistent across app, logs, traces, and error events.
- Preserve server stack traces with source maps in production.
- Keep client sourcemaps private while retaining them for debugging.
- Use a single-server blue/green workflow for limited-production cutovers.

## Release Metadata Contract

Every deployment must define:

- `APP_VERSION` (semantic version, e.g. `0.1.0`)
- `GIT_COMMIT` (short SHA, e.g. `a1b2c3d4`)
- `APP_RELEASE` (immutable build id, e.g. `0.1.0+a1b2c3d4`)
- `BUILD_TIME` (ISO timestamp)
- `BUILD_ENV` (`staging` or `production`)

App behavior:

- Backend telemetry uses `service.version = APP_RELEASE`.
- Logger base fields include `release`, `serviceVersion`, `environment`.
- Admin config page displays `App Version` and `App Release`.
- Frontend error events include release in payload.

## Sourcemap Handling

### Server sourcemaps

- Keep server sourcemaps next to built server artifacts in `dist/server`.
- Runtime must set `NODE_OPTIONS=--enable-source-maps`.
- Do not strip server map files from image.

### Client sourcemaps

- Build with sourcemaps enabled.
- During image build, move `dist/client/*.map` into:
  - `/app/sourcemaps/<APP_RELEASE>/client/...`
- Do **not** expose `/app/sourcemaps` via nginx or app static routes.
- This keeps browser users from downloading maps while preserving private symbolication assets.

### Retention

- Retain at least the last 20 releases, or 90 days, whichever is larger.
- Prune old sourcemaps monthly.

Example prune script:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /var/lib/kosarica/sourcemaps
ls -1dt */ | tail -n +21 | xargs -r rm -rf
```

## Blue/Green On One Server

This is single-host blue/green (not multi-host HA).

### Model

- `blue` = currently live app container
- `green` = candidate release container
- nginx upstream points to one slot at a time

### Cutover sequence

1. Deploy candidate release to inactive slot (`green`).
2. Run health checks and smoke tests against `green`.
3. Switch nginx upstream from `blue` to `green`.
4. Keep previous slot running for rollback window.
5. If stable, recycle old slot.

### Rollback sequence

1. Point nginx upstream back to previous slot.
2. Verify `/api/health` and admin build release.
3. Keep failed candidate for investigation, then remove.

## Pre-Deploy Verification

Run before each limited-production deploy:

```bash
kamal app status
kamal accessory status
curl -f http://localhost:3000/api/health
```

Confirm release values:

- `APP_RELEASE` in deployment env
- `App Release` in admin config page
- new logs contain expected `release`

## Post-Deploy Verification

- OpenObserve:
  - traces and logs continue arriving
  - no sudden error spike alert
- API health endpoint is healthy
- login + one critical user flow works
- client error ingest endpoint returns `204` for test payload

## Troubleshooting

### Stack traces still minified on server

- Verify `NODE_OPTIONS=--enable-source-maps` in runtime env.
- Verify `dist/server/*.map` exists in container.

### Client errors missing release

- Verify `VITE_APP_RELEASE` or `APP_RELEASE` build-time value.
- Verify frontend build was rebuilt (not stale container).

### Sourcemaps accidentally public

- Check nginx/static config for `.map` serving rules.
- Confirm `dist/client/*.map` were moved to `/app/sourcemaps/<release>/client`.
