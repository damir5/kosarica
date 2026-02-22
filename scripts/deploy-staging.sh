#!/usr/bin/env bash
set -euo pipefail

PROXY_CONTAINER_NAME="kamal-socat-proxy"
REGISTRY_PORT="5500"

log() {
  echo "[deploy-staging] $*"
}

is_running_in_docker_container() {
  local container_id

  container_id="$(hostname)"
  docker inspect "${container_id}" >/dev/null 2>&1
}

ensure_registry_proxy() {
  local container_id

  if ! is_running_in_docker_container; then
    log "Running outside Docker container. Skipping local socat proxy."
    return 0
  fi

  if ! getent hosts host.docker.internal >/dev/null 2>&1; then
    log "host.docker.internal is not resolvable. Skipping local socat proxy."
    return 0
  fi

  container_id="$(hostname)"

  if docker ps --format '{{.Names}}' | grep -Fxq "${PROXY_CONTAINER_NAME}"; then
    log "socat proxy is already running."
    return 0
  fi

  docker rm -f "${PROXY_CONTAINER_NAME}" >/dev/null 2>&1 || true

  log "Starting socat proxy ${REGISTRY_PORT} -> host.docker.internal:${REGISTRY_PORT}."
  docker run --pull=missing --detach \
    --name "${PROXY_CONTAINER_NAME}" \
    --network "container:${container_id}" \
    alpine/socat \
    "TCP-LISTEN:${REGISTRY_PORT},fork,reuseaddr,bind=127.0.0.1" \
    "TCP:host.docker.internal:${REGISTRY_PORT}" >/dev/null
}

main() {
  ensure_registry_proxy
  mise exec ruby@3.3 -- kamal deploy -c kamal.yml "$@"
}

main "$@"
