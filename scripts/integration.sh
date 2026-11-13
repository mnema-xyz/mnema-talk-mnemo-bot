#!/usr/bin/env bash
# Runs the integration test: builds Mnema Talk from a checkout, starts a
# throwaway stack with Docker, adds Mnemo from its manifest, and checks
# mentions, threads, /ask and the buttons with the fake AI provider. No AI
# provider and no network beyond Docker images is involved.
#
#   MNEMA_SRC=../mnema-talk scripts/integration.sh
#
# KEEP=1 leaves the stack running for a look (docker compose -p <project> down -v).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${MNEMA_SRC:?set MNEMA_SRC to a mnema-talk checkout (the bot platform must be in it)}"
MNEMA_SRC="$(cd "$MNEMA_SRC" && pwd)"
export MNEMA_SRC

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
export IT_APP_PORT="${IT_APP_PORT:-$(free_port)}"
export IT_JWT_SECRET="$(openssl rand -hex 32)"
export IT_ADMIN_PASSWORD="it-$(openssl rand -hex 10)"
PROJECT="${IT_PROJECT:-mnemo-it-$$}"
COMPOSE=(docker compose -p "$PROJECT" -f test/integration/docker-compose.yml)

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then "${COMPOSE[@]}" logs --tail 80 mnema >&2 || true; fi
  if [ "${KEEP:-0}" != "1" ]; then "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; fi
  exit "$status"
}
trap cleanup EXIT

echo "==> building and starting Mnema Talk from $MNEMA_SRC (project $PROJECT, port $IT_APP_PORT)"
"${COMPOSE[@]}" up -d --build --wait mnema || "${COMPOSE[@]}" up -d --build mnema
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$IT_APP_PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$IT_APP_PORT/api/health" >/dev/null

echo "==> running the integration test"
IT_URL="http://127.0.0.1:$IT_APP_PORT" IT_ADMIN_USER=it_owner IT_ADMIN_PASSWORD="$IT_ADMIN_PASSWORD" \
  node --test --test-timeout=180000 test/integration/*.itest.ts
