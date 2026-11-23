#!/usr/bin/env bash
# Pinpoint one-command demo.
#
# Starts the server in demo mode and the glasses preview, prints the official
# Even Hub simulator command, and stops both processes on Ctrl-C. It only ever
# stops the processes it started. Requires Node.js 22.13+ and curl.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVER_PORT="${PINPOINT_PORT:-8787}"
GLASSES_PORT="${PINPOINT_GLASSES_PORT:-4173}"
SERVER_PID=""
GLASSES_PID=""

log() { printf '\n[pinpoint-demo] %s\n' "$*"; }

kill_tree() {
  local pid="$1" child
  [[ -z "$pid" ]] && return 0
  while read -r child; do
    [[ -n "$child" ]] && kill_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -TERM "$pid" 2>/dev/null || true
}

stop_tree() {
  local pid="$1" i
  [[ -z "$pid" ]] && return 0
  kill_tree "$pid"
  for i in {1..30}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "$GLASSES_PID" || -n "$SERVER_PID" ]]; then
    log "Stopping the demo..."
  fi
  stop_tree "$GLASSES_PID"
  stop_tree "$SERVER_PID"
  GLASSES_PID=""
  SERVER_PID=""
  exit "$code"
}
trap cleanup EXIT INT TERM

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  # Portable fallback for Linux images without lsof.
  if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then
    return 0
  fi
  return 1
}

for port in "$SERVER_PORT" "$GLASSES_PORT"; do
  if port_busy "$port"; then
    printf '[pinpoint-demo] Port %s is already in use.\n' "$port" >&2
    printf 'Stop that process first, or choose another port:\n' >&2
    printf '  PINPOINT_PORT=8788 PINPOINT_GLASSES_PORT=4174 npm run demo\n' >&2
    exit 1
  fi
done

if ! command -v node >/dev/null 2>&1; then
  printf '[pinpoint-demo] Node.js 22.13 or newer is required.\n' >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  printf '[pinpoint-demo] curl is required to check the local URLs.\n' >&2
  exit 1
fi

install_if_missing() {
  local app="$1"
  if [[ -d "$app/node_modules" ]]; then
    return 0
  fi
  log "Installing $app dependencies (first run only)..."
  if [[ -f "$app/package-lock.json" ]]; then
    npm --prefix "$app" ci
  else
    npm --prefix "$app" install
  fi
}

install_if_missing apps/server
install_if_missing apps/glasses

log "Starting the Pinpoint server in demo mode on port $SERVER_PORT..."
PINPOINT_MODE=demo \
PINPOINT_PORT="$SERVER_PORT" \
SPLITTER_PROVIDER=fixture \
TELEGRAM_BOT_TOKEN= \
TELEGRAM_CHAT_ID= \
  npm --prefix apps/server start &
SERVER_PID=$!

wait_for_health() {
  local i
  for i in {1..120}; do
    if curl -fsS "http://127.0.0.1:$SERVER_PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.5
  done
  return 1
}

if ! wait_for_health; then
  printf '[pinpoint-demo] The server did not become healthy. See the output above.\n' >&2
  exit 1
fi

log "Starting the glasses preview on port $GLASSES_PORT..."
VITE_PINPOINT_SERVER="http://127.0.0.1:$SERVER_PORT" \
  npm --prefix apps/glasses run dev -- --port "$GLASSES_PORT" &
GLASSES_PID=$!

wait_for_preview() {
  local i
  for i in {1..80}; do
    if curl -fsS "http://127.0.0.1:$GLASSES_PORT/" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$GLASSES_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.25
  done
  return 1
}

if ! wait_for_preview; then
  printf '[pinpoint-demo] The glasses preview did not start. See the output above.\n' >&2
  exit 1
fi

cat <<EOF

  Pinpoint demo is running.
  -------------------------
  Glasses preview : http://127.0.0.1:$GLASSES_PORT
  Server health   : http://127.0.0.1:$SERVER_PORT/api/health
  Simulator       : npm --prefix apps/glasses run simulator -- http://127.0.0.1:$GLASSES_PORT

  The preview page has touchpad buttons (up, down, tap, double tap, menu).
  The simulator shows the same screens in the official Even Hub frame.
  Mode is demo: no T3 Code, no Telegram bot, no API key, nothing leaves this machine.

  Press Ctrl-C to stop both processes.
EOF

while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$GLASSES_PID" 2>/dev/null; do
  sleep 1
done

log "One of the demo processes stopped; cleaning up."
exit 1
