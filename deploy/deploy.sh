#!/usr/bin/env bash
# Deploy Pinpoint Cloud to your own server (SSH alias in PINPOINT_DEPLOY_HOST).
#
#   ./deploy/deploy.sh              # build + recreate, then wait for health
#   PINPOINT_MODE=demo ./deploy/deploy.sh
#   PINPOINT_SKIP_BUILD=1 ./deploy/deploy.sh
#
# Idempotent: safe to run again for every release. Only touches
# /srv/apps/pinpoint-cloud and the pinpoint-cloud compose project.
set -euo pipefail

HOST="${PINPOINT_DEPLOY_HOST:?set PINPOINT_DEPLOY_HOST to the SSH alias of your server}"
REMOTE_DIR="/srv/apps/pinpoint-cloud"
PROJECT="pinpoint-cloud"
PUBLIC_URL="${PINPOINT_PUBLIC_URL:-https://pinpoint-api.qolso.com}"
LOCAL_PORT="${PINPOINT_LOCAL_PORT:-4390}"
MODE="${PINPOINT_MODE:-cloud}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }

say "1/4 syncing checkout to ${HOST}:${REMOTE_DIR}"
ssh "$HOST" "sudo -n install -d -o \$(id -u) -g \$(id -g) '${REMOTE_DIR}'"
# Only the paths the image needs; never ship node_modules, .data or env files.
# (macOS ships openrsync, which ignores --files-from, so use tar for a clean copy.)
ssh "$HOST" "rm -rf '${REMOTE_DIR}/apps/server' '${REMOTE_DIR}/shared' '${REMOTE_DIR}/demo' '${REMOTE_DIR}/deploy'"
COPYFILE_DISABLE=1 tar -czf - -C "$ROOT" \
  --exclude 'apps/server/node_modules' \
  --exclude 'apps/server/.data' \
  --exclude 'apps/server/.env*' \
  apps/server/src \
  apps/server/package.json \
  apps/server/package-lock.json \
  apps/server/tsconfig.json \
  shared \
  demo/fixtures \
  demo/sample \
  deploy \
  | ssh "$HOST" "tar -xzf - -C '${REMOTE_DIR}'"

if [ -n "${PINPOINT_AUDIT_LOG:-}" ]; then
say "2/4 recording the deploy in ${PINPOINT_AUDIT_LOG}"
LEDGER_LINE="$(printf '{"ts":"%s","actor":"thread:pinpoint-cloud-deploy","action":"deploy","subject":"pinpoint-cloud (pinpoint-api.qolso.com)","evidence":"deploy/deploy.sh rsync + docker compose up -d --build; mode=%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${MODE}")"
printf '%s\n' "${LEDGER_LINE}" | ssh "$HOST" "sudo tee -a '${PINPOINT_AUDIT_LOG}' >/dev/null"
fi

say "3/4 building and starting the ${PROJECT} project (mode=${MODE})"
if [ "${PINPOINT_SKIP_BUILD:-0}" = "1" ]; then
  ssh "$HOST" "cd '${REMOTE_DIR}' && PINPOINT_MODE='${MODE}' docker compose -p '${PROJECT}' -f deploy/compose.yml up -d"
else
  ssh "$HOST" "cd '${REMOTE_DIR}' && PINPOINT_MODE='${MODE}' docker compose -p '${PROJECT}' -f deploy/compose.yml up -d --build"
fi

say "4/4 waiting for health"
for _ in $(seq 1 60); do
  if body="$(curl -fsS --max-time 5 "${PUBLIC_URL}/api/health" 2>/dev/null)"; then
    echo "public health OK: ${body}"
    exit 0
  fi
  sleep 3
done

echo "public endpoint not healthy yet; checking the container through SSH loopback"
if body="$(ssh "$HOST" "curl -fsS --max-time 5 'http://127.0.0.1:${LOCAL_PORT}/api/health'" 2>/dev/null)"; then
  echo "container health OK (public layer not reachable): ${body}"
  echo "Public URL check: curl -sS ${PUBLIC_URL}/api/health"
  exit 0
fi

echo "health check FAILED — inspect with:"
echo "  ssh ${HOST} 'docker logs --tail 80 pinpoint-cloud'"
echo "  ssh ${HOST} 'docker ps --filter name=pinpoint-cloud'"
exit 1
